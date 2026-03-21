/**
 * Search Engine - Vector Space Model
 * Implements retrieval using cosine similarity with tf*idf weighting.
 * Supports:
 * - Phrase search (quoted strings, e.g. "machine learning")
 * - Excluded terms (prefixed with -, e.g. python -java)
 * - Title match boosting
 * - Ranked results (top 50)
 */

import { stem } from '../indexer/porterStemmer.js';
import { tokenize, isStopword, loadStopwords, getStopwords } from '../indexer/tokenizer.js';
import db from '../storage/db.js';
import { CONFIG, KEYS } from '../config.js';

/**
 * Compute the magnitude (L2 norm) of a document's tf-idf vector.
 * Uses the forward index to get all terms in the document.
 *
 * ||d|| = sqrt(sum(tf-idf(t,d)²)) for all terms t in document d
 *
 * @param {number} pageId - Document ID
 * @param {number} totalDocs - Total number of documents
 * @returns {Promise<number>} - Document vector magnitude
 */
async function computeDocScore(pageId, totalDocs, queryTerms) {
  const forwardIdx = await db.getForwardIndex(pageId);
  if (!forwardIdx || forwardIdx.length === 0) return { magnitude: 0, dotProduct: 0 };

  const maxTf = Math.max(...forwardIdx.map(e => e.tf));
  const queryWordIds = [];
  for (const term of queryTerms) {
    const wid = await db.wordExists(term);
    if (wid) queryWordIds.push(wid);
  }
  const queryWordIdSet = new Set(queryWordIds);

  let sumSquares = 0;
  let dotProduct = 0;

  const dfs = await Promise.all(forwardIdx.map(e => db.getInvertedIndex(e.wordId)));
  for (let i = 0; i < forwardIdx.length; i++) {
    const entry = forwardIdx[i];
    const postings = dfs[i];
    if (postings.length === 0) continue;
    const normTf = entry.tf / maxTf;
    const idf = Math.log2(totalDocs / postings.length);
    const weight = normTf * idf;
    sumSquares += weight * weight;
    if (queryWordIdSet.has(entry.wordId)) {
      dotProduct += weight;
    }
  }

  return { magnitude: Math.sqrt(sumSquares), dotProduct };
}

/**
 * Parse a query string into terms, phrases, and excluded terms.
 * - Quoted strings are treated as phrases (e.g. "machine learning")
 * - Unquoted terms prefixed with - are excluded (e.g. python -java)
 * - Quoted phrases prefixed with - are excluded (e.g. movie -"index page")
 * Example: `machine -java "deep learning" university`
 *   -> terms: ["machin", "univers"], phrases: [["deep", "learn"]], excludeTerms: ["java"], excludePhrases: []
 * Example: `python -"test page" -java`
 *   -> terms: ["python"], phrases: [], excludeTerms: ["java"], excludePhrases: [["test", "page"]]
 *
 * @param {string} query - Raw query string
 * @returns {{ terms: string[], phrases: string[][], excludeTerms: string[], excludePhrases: string[][] }}
 */
export function parseQuery(query) {
  const terms = [];
  const phrases = [];
  const excludeTerms = [];
  const excludePhrases = [];
  const allMatchedPositions = [];

  const phraseRegex = /-?"([^"]+)"/g;
  let match;
  while ((match = phraseRegex.exec(query)) !== null) {
    const isExclude = match[0].startsWith('-');
    const phraseTokens = tokenize(match[1])
      .filter(w => !isStopword(w))
      .map(w => stem(w));

    if (phraseTokens.length > 0) {
      if (isExclude) {
        excludePhrases.push(phraseTokens);
      } else {
        phrases.push(phraseTokens);
      }
    }
    allMatchedPositions.push({ start: match.index, end: match.index + match[0].length });
  }

  let remaining = query;
  for (let i = allMatchedPositions.length - 1; i >= 0; i--) {
    const { start, end } = allMatchedPositions[i];
    remaining = remaining.slice(0, start) + ' ' + remaining.slice(end);
  }

  const rawTokens = remaining.trim().split(/\s+/);
  const seenExclude = new Set();
  for (const token of rawTokens) {
    if (!token) continue;
    if (token.startsWith('-') && token.length > 1) {
      const stripped = token.slice(1);
      const stemmed = stem(stripped);
      if (!isStopword(stripped) && !seenExclude.has(stemmed)) {
        excludeTerms.push(stemmed);
        seenExclude.add(stemmed);
      }
    } else if (!isStopword(token)) {
      const stemmed = stem(token);
      if (!terms.includes(stemmed)) {
        terms.push(stemmed);
      }
    }
  }

  for (const phraseTokens of excludePhrases) {
    if (phraseTokens.length === 1) {
      if (!seenExclude.has(phraseTokens[0])) {
        excludeTerms.push(phraseTokens[0]);
        seenExclude.add(phraseTokens[0]);
      }
    }
  }

  return { terms, phrases, excludeTerms, excludePhrases };
}

/**
 * Get all page IDs that contain a given term.
 * @param {number} wordId - The word ID
 * @returns {Promise<Array<{pageId: number, tf: number}>>}
 */
async function getPostings(wordId) {
  return await db.getInvertedIndex(wordId);
}

async function checkPhraseInDocument(pageId, phraseTokens, field) {
  if (phraseTokens.length === 0) return true;

  const docWords = field === 'title' ? await db.getTitleWords(pageId) : await db.getForwardIndex(pageId);

  const firstWordId = await db.wordExists(phraseTokens[0]);
  const firstPositions = docWords?.find(t => t.wordId === firstWordId)?.positions || [];

  for (const startPos of firstPositions) {
    let prevPos = startPos;
    let match = true;
    for (let k = 1; k < phraseTokens.length; k++) {
      const wordId = await db.wordExists(phraseTokens[k]);
      const positions = docWords?.find(t => t.wordId === wordId)?.positions || [];
      const nextPos = positions.find(p => p > prevPos);
      if (nextPos === undefined) {
        match = false;
        break;
      }
      prevPos = nextPos;
    }
    if (match) return true;
  }

  return false;
}

/**
 * Execute a search query.
 *
 * @param {string} queryString - The raw query string
 * @returns {Promise<Array>} - Ranked results with scores and page data
 */
export async function search(queryString) {
  if (!queryString || queryString.trim().length === 0) {
    return [];
  }

  // Ensure stopwords are loaded
  if (getStopwords().size === 0) {
    loadStopwords();
  }

  const { terms, phrases, excludeTerms, excludePhrases } = parseQuery(queryString);

  if (terms.length === 0 && phrases.length === 0 && excludeTerms.length === 0 && excludePhrases.length === 0) {
    return [];
  }

  const totalDocs = await db.getTotalDocuments();
  if (totalDocs === 0) return [];

  const excludedDocIds = new Set();

  for (const exWord of excludeTerms) {
    const wordId = await db.wordExists(exWord);
    if (!wordId) continue;
    for (const { pageId } of await getPostings(wordId)) {
      excludedDocIds.add(pageId);
    }
    for (const pageId of await db.getPagesWithWordInTitle(wordId)) {
      excludedDocIds.add(pageId);
    }
  }

  for (const exPhrase of excludePhrases) {
    if (exPhrase.length === 0) continue;
    const phraseCandidateDocs = new Set();
    for (let i = 0; i < exPhrase.length; i++) {
      const wordId = await db.wordExists(exPhrase[i]);
      if (!wordId) { phraseCandidateDocs.clear(); break; }
      const postings = await getPostings(wordId);
      const titlePostings = await db.getPagesWithWordInTitle(wordId);
      if (i === 0) {
        for (const p of postings) phraseCandidateDocs.add(p.pageId);
        for (const pid of titlePostings) phraseCandidateDocs.add(pid);
      } else {
        const docsWithTerm = new Set(postings.map(p => p.pageId));
        const titleDocs = new Set(titlePostings);
        for (const docId of phraseCandidateDocs) {
          if (!docsWithTerm.has(docId) && !titleDocs.has(docId)) {
            phraseCandidateDocs.delete(docId);
          }
        }
      }
    }
    if (phraseCandidateDocs.size > 0) {
      for (const pageId of phraseCandidateDocs) {
        if (await checkPhraseInDocument(pageId, exPhrase, 'body') ||
            await checkPhraseInDocument(pageId, exPhrase, 'title')) {
          excludedDocIds.add(pageId);
        }
      }
    }
  }

  const docScores = new Map();

  for (const term of terms) {
    const wordId = await db.wordExists(term);
    if (!wordId) continue;
    const postings = await getPostings(wordId);
    if (postings.length === 0) continue;
    for (const { pageId } of postings) {
      if (excludedDocIds.has(pageId)) continue;
      if (!docScores.has(pageId)) {
        docScores.set(pageId, { titleMatches: 0, phraseTitleBoost: 0, phraseBodyBoost: 0 });
      }
      const entry = docScores.get(pageId);
      const inTitle = await db.wordInTitle(wordId, pageId);
      if (inTitle) entry.titleMatches++;
    }
  }

  for (const phraseTokens of phrases) {
    const candidateDocs = new Set();
    for (let i = 0; i < phraseTokens.length; i++) {
      const wordId = await db.wordExists(phraseTokens[i]);
      if (!wordId) { candidateDocs.clear(); break; }
      const postings = await getPostings(wordId);
      const titlePostings = await db.getPagesWithWordInTitle(wordId);
      if (postings.length === 0 && titlePostings.length === 0) { candidateDocs.clear(); break; }
      if (i === 0) {
        for (const p of postings) candidateDocs.add(p.pageId);
        for (const pid of titlePostings) candidateDocs.add(pid);
      } else {
        const docsWithTerm = new Set(postings.map(p => p.pageId));
        const titleDocs = new Set(titlePostings);
        for (const docId of candidateDocs) {
          if (!docsWithTerm.has(docId) && !titleDocs.has(docId)) {
            candidateDocs.delete(docId);
          }
        }
      }
    }
    for (const pageId of candidateDocs) {
      if (excludedDocIds.has(pageId)) continue;
      const inTitle = await checkPhraseInDocument(pageId, phraseTokens, 'title');
      const inBody = await checkPhraseInDocument(pageId, phraseTokens, 'body');
      if (inTitle || inBody) {
        if (!docScores.has(pageId)) {
          docScores.set(pageId, { titleMatches: 0, phraseTitleBoost: 0, phraseBodyBoost: 0 });
        }
        const entry = docScores.get(pageId);
        if (inTitle) entry.phraseTitleBoost += 5.0 * CONFIG.search.titleBoost;
        if (inBody) entry.phraseBodyBoost += 5.0;
      }
    }
  }

  if (docScores.size === 0) return [];

  const queryMagnitude = Math.sqrt(terms.length);
  const hasTerms = queryMagnitude > 0;
  const scored = [];
  const prWeight = CONFIG.search.pagerankWeight || 0;
  let maxPR = 0;

  for (const [pageId, entry] of docScores) {
    if (hasTerms) {
      const { magnitude, dotProduct } = await computeDocScore(pageId, totalDocs, terms);
      if (magnitude === 0) continue;
      const titleBoost = (entry.titleMatches / terms.length) * (CONFIG.search.titleBoost - 1) * dotProduct;
      const cosineScore = (dotProduct + titleBoost + entry.phraseBodyBoost + entry.phraseTitleBoost) / (queryMagnitude * magnitude);
      if (cosineScore > 0) scored.push({ pageId, score: cosineScore });
    } else {
      const score = entry.phraseBodyBoost + entry.phraseTitleBoost;
      if (score > 0) scored.push({ pageId, score });
    }
  }

  if (prWeight > 0) {
    for (const { pageId } of scored) {
      const pr = await db.getPageRank(pageId);
      if (pr && pr > maxPR) maxPR = pr;
    }
    if (maxPR > 0) {
      for (const item of scored) {
        const pr = await db.getPageRank(item.pageId) || 0;
        const normPR = pr / maxPR;
        item.score = item.score * (1 - prWeight) + normPR * prWeight;
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, CONFIG.search.maxResults);

  // Build result objects with page data
  const results = [];
  for (const { pageId, score } of topResults) {
    const pageData = await db.getPageData(pageId);
    if (!pageData) continue;

    const keywords = await db.getPageStats(pageId);
    const childIds = await db.getChildren(pageId);
    const parentIds = await db.getParents(pageId);

    const childUrls = (await Promise.all(childIds.map(id => db.getUrlByPageId(id)))).filter(Boolean);
    const parentUrls = (await Promise.all(parentIds.map(id => db.getUrlByPageId(id)))).filter(Boolean);

    results.push({
      score: Math.round(score * 10000) / 10000,
      pageId,
      title: pageData.title,
      url: pageData.url,
      lastModified: pageData.lastModified,
      size: pageData.size,
      keywords: (keywords || []).slice(0, 5),
      childUrls: childUrls.slice(0, 10),
      parentUrls: parentUrls.slice(0, 10)
    });
  }

  return results;
}

export default { parseQuery, search };

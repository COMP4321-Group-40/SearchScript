/**
 * Search Engine - Vector Space Model
 * Implements retrieval using cosine similarity with tf*idf weighting.
 * Supports:
 * - Phrase search (quoted strings)
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
    const wid = await db.getWordId(term);
    if (wid) queryWordIds.push(wid);
  }
  const queryWordIdSet = new Set(queryWordIds);

  let sumSquares = 0;
  let dotProduct = 0;

  for (const entry of forwardIdx) {
    const df = await db.getDocumentFrequency(entry.wordId);
    if (df === 0) continue;
    const normTf = entry.tf / maxTf;
    const idf = Math.log2(totalDocs / df);
    const weight = normTf * idf;
    sumSquares += weight * weight;
    if (queryWordIdSet.has(entry.wordId)) {
      dotProduct += weight;
    }
  }

  return { magnitude: Math.sqrt(sumSquares), dotProduct };
}

/**
 * Parse a query string into terms and phrases.
 * Quoted strings are treated as phrases.
 * Example: `hong kong "machine learning" university`
 *   -> terms: ["hong", "kong", "university"], phrases: ["machine learning"]
 *
 * @param {string} query - Raw query string
 * @returns {{ terms: string[], phrases: string[][] }}
 */
export function parseQuery(query) {
  const terms = [];
  const phrases = [];

  // Extract quoted phrases first
  const phraseRegex = /"([^"]+)"/g;
  let match;
  const phrasePositions = [];

  while ((match = phraseRegex.exec(query)) !== null) {
    const phraseText = match[1];
    const phraseTokens = tokenize(phraseText)
      .filter(w => !isStopword(w))
      .map(w => stem(w));

    if (phraseTokens.length > 0) {
      phrases.push(phraseTokens);
    }
    phrasePositions.push({ start: match.index, end: match.index + match[0].length });
  }

  // Remove phrases from query, process remaining as terms
  let remaining = query;
  for (let i = phrasePositions.length - 1; i >= 0; i--) {
    const { start, end } = phrasePositions[i];
    remaining = remaining.slice(0, start) + ' ' + remaining.slice(end);
  }

  // Tokenize remaining text
  const rawTokens = tokenize(remaining);
  for (const token of rawTokens) {
    if (!isStopword(token)) {
      terms.push(stem(token));
    }
  }

  return { terms, phrases };
}

/**
 * Get all page IDs that contain a given term.
 * @param {number} wordId - The word ID
 * @returns {Promise<Array<{pageId: number, tf: number}>>}
 */
async function getPostings(wordId) {
  return await db.getInvertedIndex(wordId);
}

/**
 * Check if a phrase appears in a document (title or body).
 * Phrase tokens must appear in consecutive positions.
 *
 * @param {number} pageId - Document ID
 * @param {string[]} phraseTokens - Array of stemmed tokens in the phrase
 * @param {string} field - 'title' or 'body'
 * @returns {Promise<boolean>}
 */
async function checkPhraseInDocument(pageId, phraseTokens, field) {
  if (phraseTokens.length === 0) return true;
  if (phraseTokens.length === 1) {
    // Single word phrase - just check if it exists
    const wordId = await db.getWordId(phraseTokens[0]);
    if (field === 'title') {
      return await db.wordInTitle(wordId, pageId);
    } else {
      const forwardIdx = await db.getForwardIndex(pageId);
      return forwardIdx.some(entry => entry.wordId === wordId);
    }
  }

  // Multi-word phrase: check consecutive positions
  const firstWordId = await db.getWordId(phraseTokens[0]);
  const secondWordId = await db.getWordId(phraseTokens[1]);

  let firstPositions;
  if (field === 'title') {
    const titleWords = await db.getTitleWords(pageId);
    const entry = titleWords.find(tw => tw.wordId === firstWordId);
    firstPositions = entry ? entry.positions : [];
  } else {
    const forwardIdx = await db.getForwardIndex(pageId);
    const entry = forwardIdx.find(e => e.wordId === firstWordId);
    firstPositions = entry ? entry.positions : [];
  }

  // For each position of first word, check if subsequent words follow consecutively
  for (const pos of firstPositions) {
    let match = true;
    for (let k = 1; k < phraseTokens.length; k++) {
      const wordId = await db.getWordId(phraseTokens[k]);
      let positions;
      if (field === 'title') {
        const titleWords = await db.getTitleWords(pageId);
        const entry = titleWords.find(tw => tw.wordId === wordId);
        positions = entry ? entry.positions : [];
      } else {
        const forwardIdx = await db.getForwardIndex(pageId);
        const entry = forwardIdx.find(e => e.wordId === wordId);
        positions = entry ? entry.positions : [];
      }

      if (!positions.includes(pos + k)) {
        match = false;
        break;
      }
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

  // Parse query into terms and phrases
  const { terms, phrases } = parseQuery(queryString);

  if (terms.length === 0 && phrases.length === 0) {
    return [];
  }

  const totalDocs = await db.getTotalDocuments();
  if (totalDocs === 0) return [];

  const docScores = new Map();

  for (const term of terms) {
    const wordId = await db.getWordId(term);
    if (!wordId) continue;
    const postings = await getPostings(wordId);
    if (postings.length === 0) continue;
    for (const { pageId } of postings) {
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
      const wordId = await db.getWordId(phraseTokens[i]);
      if (!wordId) { candidateDocs.clear(); break; }
      const postings = await getPostings(wordId);
      if (postings.length === 0) { candidateDocs.clear(); break; }
      if (i === 0) {
        for (const p of postings) candidateDocs.add(p.pageId);
      } else {
        const docsWithTerm = new Set(postings.map(p => p.pageId));
        for (const docId of candidateDocs) {
          if (!docsWithTerm.has(docId)) candidateDocs.delete(docId);
        }
      }
    }
    for (const pageId of candidateDocs) {
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

  for (const [pageId, entry] of docScores) {
    if (hasTerms) {
      const { magnitude, dotProduct } = await computeDocScore(pageId, totalDocs, terms);
      if (magnitude === 0) continue;
      const titleBoost = (entry.titleMatches / terms.length) * (CONFIG.search.titleBoost - 1) * (dotProduct / terms.length);
      const cosineScore = (dotProduct + titleBoost + entry.phraseBodyBoost + entry.phraseTitleBoost) / (queryMagnitude * magnitude);
      if (cosineScore > 0) scored.push({ pageId, score: cosineScore });
    } else {
      const score = entry.phraseBodyBoost + entry.phraseTitleBoost;
      if (score > 0) scored.push({ pageId, score });
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

    const childUrls = [];
    for (const childId of childIds) {
      const url = await db.getUrlByPageId(childId);
      if (url) childUrls.push(url);
    }

    const parentUrls = [];
    for (const parentId of parentIds) {
      const url = await db.getUrlByPageId(parentId);
      if (url) parentUrls.push(url);
    }

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

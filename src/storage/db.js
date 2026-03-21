/**
 * LevelDB Storage Layer
 * Handles all database operations for the search engine
 * Schema: URL↔ID mapping, Word↔ID mapping, Forward/Inverted indexes, Link relations
 */

import { Level } from 'level';
import { CONFIG, KEYS, INITIAL_COUNTERS } from '../config.js';

let db = null;

/**
 * Initialize and open the LevelDB database
 * @param {string} dbPath - Optional custom database path
 * @returns {Level} - Database instance
 */
export async function openDB(dbPath = CONFIG.database.path) {
  if (db) {
    await closeDB();
  }
  db = new Level(dbPath, { valueEncoding: 'json' });
  await db.open();
  
  // Initialize counters if not exists or migrate from pre-totalDocuments versions
  try {
    const counters = await db.get(KEYS.COUNTERS);
    if (!('totalDocuments' in counters)) {
      counters.totalDocuments = 0;
      await db.put(KEYS.COUNTERS, counters);
    }
  } catch (e) {
    if (e.code === 'LEVEL_NOT_FOUND') {
      await db.put(KEYS.COUNTERS, INITIAL_COUNTERS);
    }
  }
  
  return db;
}

/**
 * Close the database connection
 */
export async function closeDB() {
  if (db) {
    await db.close();
    db = null;
  }
}

/**
 * Get database instance (open if not already)
 */
export async function getDB() {
  if (!db) {
    await openDB();
  }
  return db;
}

// ============================================
// COUNTER OPERATIONS
// ============================================

/**
 * Get current counters
 */
export async function getCounters() {
  const database = await getDB();
  try {
    return await database.get(KEYS.COUNTERS);
  } catch (e) {
    return { ...INITIAL_COUNTERS };
  }
}

/**
 * Update counters
 */
export async function updateCounters(counters) {
  const database = await getDB();
  await database.put(KEYS.COUNTERS, counters);
}

export async function getTotalDocuments() {
  const counters = await getCounters();
  if (typeof counters.totalDocuments === 'number') {
    return counters.totalDocuments;
  }
  const pageIds = await getAllPageIds();
  return pageIds.length;
}

export async function incrementTotalDocuments(delta) {
  await counterMutex.totalDocuments;
  let release;
  counterMutex.totalDocuments = new Promise(resolve => { release = resolve; });
  try {
    const counters = await getCounters();
    counters.totalDocuments = Math.max(0, (counters.totalDocuments || 0) + delta);
    await updateCounters(counters);
  } finally {
    release();
  }
}

// Mutex for atomic counter operations — prevents race conditions on concurrent calls
const counterMutex = { pageId: Promise.resolve(), wordId: Promise.resolve(), totalDocuments: Promise.resolve() };

/**
 * Get next page ID and increment counter (thread-safe via mutex)
 */
export async function getNextPageId() {
  // Chain onto the existing promise so concurrent callers wait their turn
  await counterMutex.pageId;
  let release;
  counterMutex.pageId = new Promise(resolve => { release = resolve; });
  try {
    const counters = await getCounters();
    const pageId = counters.nextPageId;
    counters.nextPageId++;
    await updateCounters(counters);
    return pageId;
  } finally {
    release();
  }
}

/**
 * Get next word ID and increment counter (thread-safe via mutex)
 */
export async function getNextWordId() {
  await counterMutex.wordId;
  let release;
  counterMutex.wordId = new Promise(resolve => { release = resolve; });
  try {
    const counters = await getCounters();
    const wordId = counters.nextWordId;
    counters.nextWordId++;
    await updateCounters(counters);
    return wordId;
  } finally {
    release();
  }
}

// ============================================
// URL ↔ PAGE-ID MAPPING
// ============================================

/**
 * Get page ID for a URL (returns null if not exists)
 */
export async function getPageIdByUrl(url) {
  const database = await getDB();
  try {
    const pageId = await database.get(KEYS.URL_TO_ID + url);
    return pageId;
  } catch (e) {
    return null;
  }
}

/**
 * Get URL for a page ID
 */
export async function getUrlByPageId(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.ID_TO_URL + pageId);
  } catch (e) {
    return null;
  }
}

/**
 * Store URL ↔ Page ID mapping (both directions)
 */
export async function storeUrlMapping(pageId, url) {
  const database = await getDB();
  const batch = database.batch();
  batch.put(KEYS.URL_TO_ID + url, pageId);
  batch.put(KEYS.ID_TO_URL + pageId, url);
  await batch.write();
}

// ============================================
// PAGE DATA
// ============================================

/**
 * Store page metadata
 */
export async function storePageData(pageId, pageData) {
  const database = await getDB();
  await database.put(KEYS.PAGE_DATA + pageId, {
    title: pageData.title,
    url: pageData.url,
    lastModified: pageData.lastModified,
    size: pageData.size
  });
}

/**
 * Get page metadata
 */
export async function getPageData(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.PAGE_DATA + pageId);
  } catch (e) {
    return null;
  }
}

/**
 * Get last modified date for a page
 */
export async function getLastModified(pageId) {
  const pageData = await getPageData(pageId);
  return pageData ? pageData.lastModified : null;
}

// ============================================
// WORD ↔ WORD-ID MAPPING
// ============================================

/**
 * Get word ID for a stemmed word (creates new if not exists)
 */
export async function getWordId(word) {
  const database = await getDB();
  try {
    return await database.get(KEYS.WORD_TO_ID + word);
  } catch (e) {
    const wordId = await getNextWordId();
    const batch = database.batch();
    batch.put(KEYS.WORD_TO_ID + word, wordId);
    batch.put(KEYS.ID_TO_WORD + wordId, word);
    await batch.write();
    return wordId;
  }
}

/**
 * Get word by word ID
 */
export async function getWordById(wordId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.ID_TO_WORD + wordId);
  } catch (e) {
    return null;
  }
}

export async function wordExists(word) {
  const database = await getDB();
  try {
    return await database.get(KEYS.WORD_TO_ID + word);
  } catch (e) {
    return null;
  }
}

// ============================================
// WORD FREQUENCY (pre-computed document counts)
// ============================================

/**
 * Get the pre-computed document frequency for a word.
 * Falls back to counting postings from the inverted index if not cached.
 * @param {number} wordId
 * @returns {Promise<number>} - Number of documents containing this word
 */
export async function getWordFrequency(wordId) {
  const database = await getDB();
  const key = KEYS.WORD_FREQ + wordId;
  try {
    return await database.get(key);
  } catch (e) {
    if (e.code !== 'LEVEL_NOT_FOUND') throw e;
    // Cache miss — count from inverted index and populate cache
    const postings = await getInvertedIndex(wordId);
    const count = postings.length;
    if (count > 0) {
      await database.put(key, count);
    }
    return count;
  }
}

/**
 * Get all words (for browsing feature)
 */
export async function getAllWords() {
  const database = await getDB();
  const words = [];
  for await (const [key, value] of database.iterator({ 
    gte: KEYS.ID_TO_WORD, 
    lt: KEYS.ID_TO_WORD + '~' 
  })) {
    words.push({ wordId: parseInt(key.replace(KEYS.ID_TO_WORD, '')), word: value });
  }
  return words.sort((a, b) => a.wordId - b.wordId);
}

// ============================================
// FORWARD INDEX (pageId -> [{wordId, tf, positions}])
// ============================================

/**
 * Store forward index entry for a page
 */
export async function storeForwardIndex(pageId, wordEntries) {
  const database = await getDB();
  await database.put(KEYS.FORWARD_INDEX + pageId, wordEntries);
}

/**
 * Get forward index for a page
 */
export async function getForwardIndex(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.FORWARD_INDEX + pageId);
  } catch (e) {
    return [];
  }
}

// ============================================
// INVERTED INDEX (wordId -> [{pageId, tf}])
// ============================================

/**
 * Update inverted index: add a posting for a word
 */
export async function addToInvertedIndex(wordId, pageId, tf) {
  const database = await getDB();
  let postings = [];
  try {
    postings = await database.get(KEYS.INVERTED_INDEX + wordId);
  } catch (e) {
    postings = [];
  }
  
  const existing = postings.findIndex(p => p.pageId === pageId);
  if (existing >= 0) {
    postings[existing].tf = tf;
    await database.put(KEYS.INVERTED_INDEX + wordId, postings);
  } else {
    // Read current frequency, update both posting and frequency atomically in one batch
    const currentFreq = await getWordFrequency(wordId);
    const batch = database.batch();
    postings.push({ pageId, tf });
    batch.put(KEYS.INVERTED_INDEX + wordId, postings);
    batch.put(KEYS.WORD_FREQ + wordId, currentFreq + 1);
    await batch.write();
  }
}

export async function clearPageFromInvertedIndex(pageId, wordIds) {
  const database = await getDB();
  const batch = database.batch();
  let deleted = 0;

  if (wordIds) {
    // Optimized path: only touch the specific wordIds we know about
    const affectedWordIds = [];
    for (const wordId of wordIds) {
      const key = KEYS.INVERTED_INDEX + wordId;
      let postings = [];
      try {
        postings = await database.get(key);
      } catch (e) {
        if (e.code !== 'LEVEL_NOT_FOUND') throw e;
        continue;
      }
      if (!Array.isArray(postings)) continue;
      const originalLength = postings.length;
      const filtered = postings.filter(p => p.pageId !== pageId);
      if (filtered.length !== originalLength) {
        affectedWordIds.push(wordId);
        if (filtered.length === 0) {
          batch.del(key);
        } else {
          batch.put(key, filtered);
        }
        deleted++;
      }
    }
    if (deleted > 0) {
      await batch.write();
      const freqBatch = database.batch();
      for (const wid of affectedWordIds) {
        const freqKey = KEYS.WORD_FREQ + wid;
        try {
          const freq = await database.get(freqKey);
          freq - 1 <= 0 ? freqBatch.del(freqKey) : freqBatch.put(freqKey, freq - 1);
        } catch (e) {
          if (e.code !== 'LEVEL_NOT_FOUND') throw e;
        }
      }
      await freqBatch.write();
    }
  } else {
    // Fallback: scan all inverted index entries (O(total_postings))
    const affectedWordIds = [];
    for await (const [key, postings] of database.iterator({
      gte: KEYS.INVERTED_INDEX,
      lt: KEYS.INVERTED_INDEX + '~'
    })) {
      if (!Array.isArray(postings)) continue;
      const originalLength = postings.length;
      const filtered = postings.filter(p => p.pageId !== pageId);
      if (filtered.length !== originalLength) {
        affectedWordIds.push(parseInt(key.replace(KEYS.INVERTED_INDEX, '')));
        if (filtered.length === 0) {
          batch.del(key);
        } else {
          batch.put(key, filtered);
        }
        deleted++;
      }
    }
    if (deleted > 0) {
      await batch.write();
      const freqBatch = database.batch();
      for (const wid of affectedWordIds) {
        const freqKey = KEYS.WORD_FREQ + wid;
        try {
          const freq = await database.get(freqKey);
          freq - 1 <= 0 ? freqBatch.del(freqKey) : freqBatch.put(freqKey, freq - 1);
        } catch (e) {
          if (e.code !== 'LEVEL_NOT_FOUND') throw e;
        }
      }
      await freqBatch.write();
    }
  }
  return deleted;
}

/**
 * Get all postings for a word (inverted index entry)
 */
export async function getInvertedIndex(wordId) {
  const database = await getDB();
  try {
  return await database.get(KEYS.INVERTED_INDEX + wordId);
  } catch (e) {
    return [];
  }
}

// ============================================
// TITLE INDEX
// ============================================

/**
 * Store title word positions for a page
 */
export async function storeTitleWords(pageId, titleWordEntries) {
  const database = await getDB();
  const oldTitleWords = await getTitleWords(pageId);
  await database.put(KEYS.TITLE_WORDS + pageId, titleWordEntries);
  await buildTitleInvertedIndex(pageId, titleWordEntries, oldTitleWords);
}

/**
 * Get title word positions for a page
 */
export async function getTitleWords(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.TITLE_WORDS + pageId);
  } catch (e) {
    return [];
  }
}

export async function wordInTitle(wordId, pageId) {
  const titleWords = await getTitleWords(pageId);
  return titleWords.some(tw => tw.wordId === wordId);
}

export async function buildTitleInvertedIndex(pageId, titleWordEntries, oldTitleWordEntries) {
  const database = await getDB();
  const batch = database.batch();

  const oldWordIds = oldTitleWordEntries ? oldTitleWordEntries.map(e => e.wordId) : [];
  const newWordIds = titleWordEntries.map(e => e.wordId);

  for (const wid of oldWordIds) {
    if (newWordIds.includes(wid)) continue;
    const key = KEYS.TITLE_INVERTED + wid;
    try {
      const pageIds = await database.get(key);
      const filtered = pageIds.filter(id => id !== pageId);
      if (filtered.length === 0) {
        batch.del(key);
      } else {
        batch.put(key, filtered);
      }
    } catch (e) {
      if (e.code !== 'LEVEL_NOT_FOUND') throw e;
    }
  }

  for (const entry of titleWordEntries) {
    const key = KEYS.TITLE_INVERTED + entry.wordId;
    let pageIds = [];
    try {
      pageIds = await database.get(key);
    } catch (e) {
      if (e.code !== 'LEVEL_NOT_FOUND') throw e;
    }
    if (!pageIds.includes(pageId)) {
      pageIds.push(pageId);
      batch.put(key, pageIds);
    }
  }
  await batch.write();
}

export async function getPagesWithWordInTitle(wordId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.TITLE_INVERTED + wordId);
  } catch (e) {
    return [];
  }
}

// ============================================
// LINK RELATIONS
// ============================================

/**
 * Get children page IDs for a parent page
 * @param {number} pageId - Parent page ID
 * @returns {number[]} - Array of child page IDs
 */
export async function getChildren(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.CHILDREN + pageId);
  } catch (e) {
    return [];
  }
}

/**
 * Store parent links for a page
 */
export async function storeParents(pageId, parentPageIds) {
  const database = await getDB();
  await database.put(KEYS.PARENTS + pageId, parentPageIds);
}

/**
 * Get parent page IDs for a child page
 * @param {number} pageId - Child page ID
 * @returns {number[]} - Array of parent page IDs
 */
export async function getParents(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.PARENTS + pageId);
  } catch (e) {
    return [];
  }
}

/**
 * Add a parent-child relationship
 */
export async function addLink(parentId, childId) {
  const database = await getDB();
  const batch = database.batch();

  const children = await getChildren(parentId);
  if (!children.includes(childId)) {
    children.push(childId);
    batch.put(KEYS.CHILDREN + parentId, children);
  }

  const parents = await getParents(childId);
  if (!parents.includes(parentId)) {
    parents.push(parentId);
    batch.put(KEYS.PARENTS + childId, parents);
  }

  await batch.write();
}

// ============================================
// STATISTICS
// ============================================

/**
 * Store page frequency statistics (top keywords)
 */
export async function storePageStats(pageId, freqData) {
  const database = await getDB();
  await database.put(KEYS.STATS_FREQ + pageId, freqData);
}

/**
 * Get page frequency statistics
 */
export async function getPageStats(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.STATS_FREQ + pageId);
  } catch (e) {
    return [];
  }
}

// ============================================
// UTILITY OPERATIONS
// ============================================

/**
 * Get all page IDs in the database
 */
export async function getAllPageIds() {
  const database = await getDB();
  const pageIds = [];
  for await (const [key] of database.iterator({
    gte: KEYS.ID_TO_URL,
    lt: KEYS.ID_TO_URL + '~'
  })) {
    pageIds.push(parseInt(key.replace(KEYS.ID_TO_URL, '')));
  }
  return pageIds.sort((a, b) => a - b);
}

/**
 * Get database statistics
 */
export async function getDBStats() {
  const pageIds = await getAllPageIds();
  const counters = await getCounters();
  return {
    totalPages: pageIds.length,
    nextPageId: counters.nextPageId,
    nextWordId: counters.nextWordId
  };
}

export async function precomputeWordFrequencies() {
  const database = await getDB();
  const wordFreqs = new Map();
  for await (const [key, postings] of database.iterator({
    gte: KEYS.INVERTED_INDEX,
    lt: KEYS.INVERTED_INDEX + '~'
  })) {
    if (!Array.isArray(postings)) continue;
    const wordId = parseInt(key.replace(KEYS.INVERTED_INDEX, ''));
    wordFreqs.set(wordId, postings.length);
  }
  const batch = database.batch();
  for (const [wordId, count] of wordFreqs) {
    batch.put(KEYS.WORD_FREQ + wordId, count);
  }
  await batch.write();
  return wordFreqs.size;
}

export async function clearDB() {
  const database = await getDB();
  await database.clear();
  await database.put(KEYS.COUNTERS, { ...INITIAL_COUNTERS });
}

// ============================================
// PAGERANK
// ============================================

export async function computePageRank(options = {}) {
  const d = options.damping || CONFIG.search.pagerankDamping || 0.85;
  const epsilon = options.epsilon || CONFIG.search.pagerankEpsilon || 0.0001;
  const maxIterations = options.maxIterations || 100;

  const pageIds = await getAllPageIds();
  const N = pageIds.length;
  if (N === 0) return { scores: {}, iterations: 0, converged: false };

  const outlinksMap = new Map();
  for (const pageId of pageIds) {
    outlinksMap.set(pageId, await getChildren(pageId));
  }

  let pr = new Map();
  for (const pageId of pageIds) pr.set(pageId, 1 / N);

  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < maxIterations; iterations++) {
    let danglingSum = 0;
    for (const pageId of pageIds) {
      const outlinks = outlinksMap.get(pageId) || [];
      if (outlinks.length === 0) danglingSum += pr.get(pageId) || 0;
    }

    const newPr = new Map();
    for (const pageId of pageIds) newPr.set(pageId, 0);

    for (const srcId of pageIds) {
      const outlinks = outlinksMap.get(srcId) || [];
      const contrib = (pr.get(srcId) || 0) / (outlinks.length || 1);
      for (const targetId of outlinks) {
        if (targetId === srcId) continue;
        newPr.set(targetId, (newPr.get(targetId) || 0) + contrib);
      }
    }

    for (const pageId of pageIds) {
      newPr.set(pageId, (1 - d) / N + d * (newPr.get(pageId) || 0) + d * (danglingSum / N));
    }

    let maxDelta = 0;
    for (const pageId of pageIds) {
      const newVal = newPr.get(pageId) || 0;
      const oldVal = pr.get(pageId) || 0;
      const delta = Math.abs(newVal - oldVal);
      if (delta > maxDelta) maxDelta = delta;
    }

    for (const pageId of pageIds) {
      pr.set(pageId, newPr.get(pageId) || 0);
    }

    if (maxDelta < epsilon) {
      converged = true;
      break;
    }
  }

  const database = await getDB();
  const batch = database.batch();
  for (const [pageId, score] of pr) {
    batch.put(KEYS.PAGE_RANK + pageId, score);
  }
  await batch.write();

  const result = {};
  for (const [pageId, score] of pr) result[pageId] = score;
  return { scores: result, iterations, converged };
}

export async function getPageRank(pageId) {
  const database = await getDB();
  try {
    return await database.get(KEYS.PAGE_RANK + pageId);
  } catch (e) {
    return null;
  }
}

export default {
  openDB,
  closeDB,
  getDB,
  getCounters,
  updateCounters,
  getNextPageId,
  getNextWordId,
  getPageIdByUrl,
  getUrlByPageId,
  storeUrlMapping,
  storePageData,
  getPageData,
  getLastModified,
  getWordId,
  getWordById,
  wordExists,
  getWordFrequency,
  getAllWords,
  storeForwardIndex,
  getForwardIndex,
  addToInvertedIndex,
  getInvertedIndex,
  clearPageFromInvertedIndex,
  getTotalDocuments,
  incrementTotalDocuments,
  storeTitleWords,
  getTitleWords,
  wordInTitle,
  getPagesWithWordInTitle,
  getChildren,
  storeParents,
  getParents,
  addLink,
  storePageStats,
  getPageStats,
  getAllPageIds,
  getDBStats,
  computePageRank,
  getPageRank,
  precomputeWordFrequencies,
  clearDB
};

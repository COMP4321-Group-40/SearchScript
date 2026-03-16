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
  
  // Initialize counters if not exists
  try {
    await db.get(KEYS.COUNTERS);
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

/**
 * Get next page ID and increment counter
 */
export async function getNextPageId() {
  const counters = await getCounters();
  const pageId = counters.nextPageId;
  counters.nextPageId++;
  await updateCounters(counters);
  return pageId;
}

/**
 * Get next word ID and increment counter
 */
export async function getNextWordId() {
  const counters = await getCounters();
  const wordId = counters.nextWordId;
  counters.nextWordId++;
  await updateCounters(counters);
  return wordId;
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

/**
 * Check if URL already exists in index
 */
export async function urlExists(url) {
  const pageId = await getPageIdByUrl(url);
  return pageId !== null;
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
  
  // Check if pageId already exists in postings
  const existing = postings.findIndex(p => p.pageId === pageId);
  if (existing >= 0) {
    postings[existing].tf = tf;
  } else {
    postings.push({ pageId, tf });
  }
  
  await database.put(KEYS.INVERTED_INDEX + wordId, postings);
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

/**
 * Get total number of documents containing a word
 */
export async function getDocumentFrequency(wordId) {
  const postings = await getInvertedIndex(wordId);
  return postings.length;
}

/**
 * Get total number of documents in the index
 */
export async function getTotalDocuments() {
  const database = await getDB();
  let count = 0;
  for await (const [key] of database.iterator({ 
    gte: KEYS.PAGE_DATA, 
    lt: KEYS.PAGE_DATA + '~' 
  })) {
    count++;
  }
  return count;
}

// ============================================
// TITLE INDEX
// ============================================

/**
 * Store title word positions for a page
 */
export async function storeTitleWords(pageId, titleWordEntries) {
  const database = await getDB();
  await database.put(KEYS.TITLE_WORDS + pageId, titleWordEntries);
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

/**
 * Check if a word appears in a page's title
 */
export async function wordInTitle(wordId, pageId) {
  const titleWords = await getTitleWords(pageId);
  return titleWords.some(tw => tw.wordId === wordId);
}

// ============================================
// LINK RELATIONS
// ============================================

/**
 * Store child links for a page
 */
export async function storeChildren(pageId, childPageIds) {
  const database = await getDB();
  await database.put(KEYS.CHILDREN + pageId, childPageIds);
}

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
  // Add child to parent's children list
  let children = await getChildren(parentId);
  if (!children.includes(childId)) {
    children.push(childId);
    await storeChildren(parentId, children);
  }
  
  // Add parent to child's parents list
  let parents = await getParents(childId);
  if (!parents.includes(parentId)) {
    parents.push(parentId);
    await storeParents(childId, parents);
  }
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
    gte: KEYS.PAGE_DATA, 
    lt: KEYS.PAGE_DATA + '~' 
  })) {
    pageIds.push(parseInt(key.replace(KEYS.PAGE_DATA, '')));
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

/**
 * Clear all data (for testing)
 */
export async function clearDB() {
  const database = await getDB();
  await database.clear();
  await database.put(KEYS.COUNTERS, { ...INITIAL_COUNTERS });
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
  urlExists,
  storePageData,
  getPageData,
  getLastModified,
  getWordId,
  getWordById,
  getAllWords,
  storeForwardIndex,
  getForwardIndex,
  addToInvertedIndex,
  getInvertedIndex,
  getDocumentFrequency,
  getTotalDocuments,
  storeTitleWords,
  getTitleWords,
  wordInTitle,
  storeChildren,
  getChildren,
  storeParents,
  getParents,
  addLink,
  storePageStats,
  getPageStats,
  getAllPageIds,
  getDBStats,
  clearDB
};

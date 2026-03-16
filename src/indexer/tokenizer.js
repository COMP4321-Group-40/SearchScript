/**
 * Tokenizer with Stopword Filtering and Stemming
 * Handles text processing pipeline: tokenize → filter stopwords → stem
 */

import { readFileSync, existsSync } from 'fs';
import { stem } from './porterStemmer.js';
import { CONFIG } from '../config.js';

let stopwords = null;

/**
 * Load stopwords from file
 * @param {string} filepath - Path to stopword list file
 */
export function loadStopwords(filepath = CONFIG.indexer.stopwordsFile) {
  if (existsSync(filepath)) {
    const content = readFileSync(filepath, 'utf-8');
    stopwords = new Set(
      content
        .split('\n')
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0)
    );
  } else {
    stopwords = new Set();
  }
  return stopwords;
}

/**
 * Get stopwords set (load if not already loaded)
 */
export function getStopwords() {
  if (stopwords === null) {
    loadStopwords();
  }
  return stopwords;
}

/**
 * Check if a word is a stopword
 * @param {string} word - Word to check
 * @returns {boolean}
 */
export function isStopword(word) {
  const sw = getStopwords();
  return sw.has(word.toLowerCase());
}

/**
 * Tokenize text into words
 * - Lowercases all text
 * - Splits on non-alphanumeric characters
 * - Filters by min/max word length
 * @param {string} text - Raw text to tokenize
 * @returns {string[]} - Array of tokens
 */
export function tokenize(text) {
  if (!text) return [];
  
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')  // Replace non-alphanumeric with space
    .split(/\s+/)                  // Split on whitespace
    .filter(word => 
      word.length >= CONFIG.indexer.minWordLength && 
      word.length <= CONFIG.indexer.maxWordLength
    );
}

/**
 * Process text through full pipeline:
 * tokenize → filter stopwords → stem
 * @param {string} text - Raw text to process
 * @returns {Object} - { tokens: string[], stemmed: string[], positions: Map }
 */
export function processText(text) {
  const rawTokens = tokenize(text);
  const positions = new Map(); // stemmed word -> array of positions
  const stemmed = [];
  const filtered = [];
  
  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    
    if (isStopword(token)) {
      continue;
    }
    
    const stemmedWord = stem(token);
    filtered.push(token);
    stemmed.push(stemmedWord);
    
    if (!positions.has(stemmedWord)) {
      positions.set(stemmedWord, []);
    }
    positions.get(stemmedWord).push(i);
  }
  
  return {
    tokens: filtered,
    stemmed,
    positions
  };
}

/**
 * Calculate term frequency for each word in document
 * @param {string[]} stemmedWords - Array of stemmed words
 * @returns {Map} - word -> tf count
 */
export function calculateTF(stemmedWords) {
  const tf = new Map();
  
  for (const word of stemmedWords) {
    tf.set(word, (tf.get(word) || 0) + 1);
  }
  
  return tf;
}

/**
 * Get top N most frequent words with their frequencies
 * @param {Map} tfMap - Term frequency map
 * @param {number} n - Number of top words to return
 * @returns {Array} - [{word, freq}, ...] sorted by freq desc
 */
export function getTopFrequentWords(tfMap, n = CONFIG.indexer.maxKeywords) {
  const entries = Array.from(tfMap.entries())
    .map(([word, freq]) => ({ word, freq }))
    .sort((a, b) => b.freq - a.freq);
  
  return entries.slice(0, n);
}

export default {
  loadStopwords,
  getStopwords,
  isStopword,
  tokenize,
  processText,
  calculateTF,
  getTopFrequentWords
};

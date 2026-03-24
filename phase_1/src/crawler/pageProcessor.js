/**
 * Page Processor
 * Functions are to parse HTML pages using Cheerio which extracts
 *   Title, Body Text, Links, and Keyword Positions
 */

import * as cheerio from 'cheerio';
import { processText, calculateTF, getTopFrequentWords } from '../indexer/tokenizer.js';
import { CONFIG } from '../config.js';
import { URL } from 'url';

/**
 * Extract title from HTML
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {string} - Page title
 */
export function extractTitle($) {
  let title = $('title').first().text().trim();
  
  // Fallback to first h1 if no title tag
  if (!title) {
    title = $('h1').first().text().trim();
  }
  
  // Fallback to first h2
  if (!title) {
    title = $('h2').first().text().trim();
  }
  
  return text.split(/\s+/).filter(w => w.length > 0) || 'Untitled';
}

/**
 * Extract body text content from HTML
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {string} - Body text
 */
export function extractBodyText($) {
  // Remove script, style, nav, footer, header tags before extracting the information
  $('script, style, nav, footer, header, noscript').remove();
  
  let text = $('body').text();
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract all hyperlinks from the page
 * Resolves the relative paths from the absolute URLs from the base URL
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {string[]} - Array of absolute URLs
 */
export function extractLinks($, baseUrl) {
  const links = [];
  const seen = new Set();
  
  $('a[href]').each((_, element) => {
    // Filters out Anchors, Javascript, Mailto, Tel, and Duplicates
    let href = $(element).attr('href');
    
    if (!href) return;
  
    if (!filterUrl(href)) return;
    
    try {
      const absoluteUrl = new URL(href, baseUrl).href;
      const cleanUrl = absoluteUrl.split('#')[0];
      
      if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
        if (!seen.has(cleanUrl)) {
          seen.add(cleanUrl);
          links.push(cleanUrl);
        }
      }
    } catch (e) {
      // Invalid URL, skip
    }
  });
  
  return links;
}

function filterUrl(linkString) {
  try {
    const url = new URL(linkString);
    // filter out opaque schemes like mailto: or javascript:
    if (url.protocol === 'mailto:' || url.protocol === 'javascript:') return false;
    // absolute links must be http or https
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    return false;
  } catch (e) {
    // relative URL – treat as wanted (will be resolved later)
    return true;
  }
}

/**
 * Get page size (number of words)
 * @param {string} text - Page text content
 * @returns {number} - Number of words
 */
export function getPageSize(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Process an HTML page and extract all required information
 * Main entry point of page processing
 * 
 * Returns object with Title, URL, Links, Text, Keywords
 * @param {string} html - Raw HTML content
 * @param {string} url - Page URL
 * @param {string} lastModified - Last modified date string
 * @param {number} contentLength - Content length from header (optional)
 * @returns {Object} - Processed page data
 */
export function processPage(html, url, lastModified = null, contentLength = null) {
  const $ = cheerio.load(html);

  const title = extractTitle($);
  const titleText = $('title').first().text().trim() || title;
  const bodyText = extractBodyText($);
  const fullText = titleText + ' ' + bodyText;
  const size = getPageSize(fullText);

  const links = extractLinks($, url);
  
  const titleProcessed = processText(titleText);
  const bodyProcessed = processText(bodyText);
  
  const topKeywords = getTopFrequentWords(
    calculateTF([...titleProcessed.stemmed, ...bodyProcessed.stemmed]),
    CONFIG.indexer.maxKeywords
  );
  
  const bodyWordEntries = [];
  for (const [word, positions] of bodyProcessed.positions) {
    bodyWordEntries.push({word, positions, tf: positions.length});
  }

  const titleWordEntries = [];
  for (const [word, positions] of titleProcessed.positions) {
    titleWordEntries.push({word, positions, tf: positions.length});
  }
  
  return {
    title,
    url,
    lastModified: lastModified || new Date().toISOString(),
    size,
    links,
    titleText,
    bodyText,
    titleProcessed,
    bodyProcessed,
    bodyWordEntries,
    titleWordEntries,
    topKeywords
  };
}

/**
 * Parse last-modified date from HTTP header
 * @param {string} dateString - Date string from header
 * @returns {string|null} - ISO date string or null
 */
export function parseLastModified(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (e) {
    return null;
  }
}

/**
 * Get a default last-modified date (current time)
 * @returns {string} - ISO date string
 */
export function getDefaultLastModified() {
  return new Date().toISOString();
}

export default {
  extractTitle,
  extractBodyText,
  extractLinks,
  getPageSize,
  processPage,
  parseLastModified,
  getDefaultLastModified
};

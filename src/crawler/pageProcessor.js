/**
 * Page Processor
 * Parses HTML pages using Cheerio to extract:
 * - Title, body text, links
 * - Keyword positions in both title and body
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
  // Try to get title from <title> tag
  let title = $('title').first().text().trim();
  
  // Fallback to first h1 if no title tag
  if (!title) {
    title = $('h1').first().text().trim();
  }
  
  // Fallback to first h2
  if (!title) {
    title = $('h2').first().text().trim();
  }
  
  return title || 'Untitled';
}

/**
 * Extract body text content from HTML
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @returns {string} - Body text
 */
export function extractBodyText($) {
  // Remove script, style, nav, footer, header tags
  $('script, style, nav, footer, header, noscript').remove();
  
  // Get text from body
  let text = $('body').text();
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract all hyperlinks from the page
 * @param {cheerio.CheerioAPI} $ - Cheerio instance
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {string[]} - Array of absolute URLs
 */
export function extractLinks($, baseUrl) {
  const links = [];
  const seen = new Set();
  
  $('a[href]').each((_, element) => {
    let href = $(element).attr('href');
    
    if (!href) return;
    
    // Skip anchors, javascript, mailto, tel
    if (href.startsWith('#') || 
        href.startsWith('javascript:') || 
        href.startsWith('mailto:') ||
        href.startsWith('tel:')) {
      return;
    }
    
    try {
      // Resolve relative URLs
      const absoluteUrl = new URL(href, baseUrl).href;
      
      // Remove fragment
      const cleanUrl = absoluteUrl.split('#')[0];
      
      // Only include http(s) URLs
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
 * @param {string} html - Raw HTML content
 * @param {string} url - Page URL
 * @param {string} lastModified - Last modified date string
 * @param {number} contentLength - Content length from header (optional)
 * @returns {Object} - Processed page data
 */
export function processPage(html, url, lastModified = null, contentLength = null) {
  const $ = cheerio.load(html);
  
  // Extract title
  const title = extractTitle($);
  
  // Extract title text for indexing (separate from body)
  const titleText = $('title').first().text().trim() || title;
  
  // Extract body text
  const bodyText = extractBodyText($);
  
  // Calculate size (number of words)
  const fullText = titleText + ' ' + bodyText;
  const size = getPageSize(fullText);
  
  // Extract links
  const links = extractLinks($, url);
  
  // Process title text for keyword extraction
  const titleProcessed = processText(titleText);
  
  // Process body text for keyword extraction
  const bodyProcessed = processText(bodyText);
  
  const topKeywords = getTopFrequentWords(
    calculateTF([...titleProcessed.stemmed, ...bodyProcessed.stemmed]),
    CONFIG.indexer.maxKeywords
  );
  
  // Build word entries with positions for body
  const bodyWordEntries = [];
  
  for (const [word, positions] of bodyProcessed.positions) {
    bodyWordEntries.push({
      word,
      positions,
      tf: positions.length
    });
  }
  
  // Build word entries for title
  const titleWordEntries = [];
  for (const [word, positions] of titleProcessed.positions) {
    titleWordEntries.push({
      word,
      positions,
      tf: positions.length
    });
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

/**
 * BFS Spider/Crawler
 * Implements breadth-first web crawling with:
 * - HEAD request check before full fetch (last-modified comparison)
 * - URL deduplication and cyclic link handling
 * - BFS queue management
 * - Integration with indexer for storing page data
 */

import axios from 'axios';
import { CONFIG } from '../config.js';
import { processPage, parseLastModified, getDefaultLastModified } from './pageProcessor.js';
import db from '../storage/db.js';
import { loadStopwords } from '../indexer/tokenizer.js';
import { sleep } from '../utils/helpers.js';

// Crawler state
const state = {
  queue: [],        // BFS queue of URLs to process
  visited: new Set(),  // URLs already visited in this session
  crawled: 0,       // Number of pages successfully crawled
  skipped: 0,       // Number of pages skipped
  errors: 0,        // Number of errors
  domain: null      // Domain restriction
};

/**
 * Extract domain from URL
 * @param {string} url
 * @returns {string}
 */
function getDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch (e) {
    return null;
  }
}

/**
 * Check if URL is within the same domain as seed
 * @param {string} url
 * @returns {boolean}
 */
function isSameDomain(url) {
  if (!state.domain) return true;
  return getDomain(url) === state.domain;
}

/**
 * Perform HEAD request to check last-modified date
 * @param {string} url
 * @returns {Object} - { needsFetch: boolean, lastModified: string|null, contentLength: number|null }
 */
async function checkHeadRequest(url) {
  try {
    const response = await axios.head(url, {
      timeout: CONFIG.crawler.requestTimeout,
      headers: {
        'User-Agent': CONFIG.crawler.userAgent
      },
      maxRedirects: 5,
      // Only accept 2xx as valid — 404/403/301/302 without Last-Modified should not be treated as "unchanged"
      validateStatus: (status) => (status >= 200 && status < 300)
    });
    
    const lastModified = response.headers['last-modified'] 
      ? parseLastModified(response.headers['last-modified']) 
      : null;
    const contentLength = response.headers['content-length'] 
      ? parseInt(response.headers['content-length'], 10) 
      : null;
    
    return {
      needsFetch: true,
      lastModified,
      contentLength,
      statusCode: response.status
    };
  } catch (e) {
    // HEAD failed entirely — cannot determine if page changed, must re-fetch
    return {
      needsFetch: true,
      lastModified: null,
      contentLength: null,
      statusCode: 0
    };
  }
}

/**
 * Perform GET request to fetch page content
 * @param {string} url
 * @returns {Object} - { html: string, lastModified: string, contentLength: number }
 */
async function fetchPage(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= CONFIG.crawler.maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        timeout: CONFIG.crawler.requestTimeout,
        headers: { 'User-Agent': CONFIG.crawler.userAgent },
        maxRedirects: 5,
        responseType: 'text',
        validateStatus: (status) => (status >= 200 && status < 300)
      });

      // Only process HTML responses — skip JSON, PDF, CSV, plain text, etc.
      const contentType = (response.headers['content-type'] || '').toLowerCase();
      if (!contentType.includes('text/html')) {
        console.log(`Skipping non-HTML: ${url} (Content-Type: ${contentType})`);
        return { pageData: null, childUrls: [] };
      }

      const lastModified = response.headers['last-modified']
        ? parseLastModified(response.headers['last-modified'])
        : getDefaultLastModified();
      const contentLength = response.headers['content-length']
        ? parseInt(response.headers['content-length'], 10) : null;
      return { html: response.data, lastModified, contentLength, statusCode: response.status };
    } catch (e) {
      lastError = e;
      if (attempt < CONFIG.crawler.maxRetries) {
        await sleep(1000 * attempt);
      }
    }
  }
  throw lastError;
}

/**
 * Index a page's content into the database
 * @param {number} pageId
 * @param {Object} pageData - Processed page data
 */
async function indexPage(pageId, pageData) {
  const { titleWordEntries, bodyWordEntries, topKeywords } = pageData;
  
  // Store title word entries (convert words to wordIds)
  const titleEntriesWithIds = [];
  for (const entry of titleWordEntries) {
    const wordId = await db.getWordId(entry.word);
    titleEntriesWithIds.push({
      wordId,
      positions: entry.positions,
      tf: entry.tf
    });
  }
  await db.storeTitleWords(pageId, titleEntriesWithIds);
  
  // Store body word entries and update inverted index
  const bodyEntriesWithIds = [];
  for (const entry of bodyWordEntries) {
    const wordId = await db.getWordId(entry.word);
    bodyEntriesWithIds.push({
      wordId,
      positions: entry.positions,
      tf: entry.tf
    });
    
    // Update inverted index
    await db.addToInvertedIndex(wordId, pageId, entry.tf);
  }
  await db.storeForwardIndex(pageId, bodyEntriesWithIds);
  
  // Store top keywords for display (up to 10)
  const topKeywordsWithWordIds = [];
  for (const kw of topKeywords) {
    topKeywordsWithWordIds.push({
      word: kw.word,
      freq: kw.freq
    });
  }
  await db.storePageStats(pageId, topKeywordsWithWordIds);
}

/**
 * Process and index a single page
 * @param {string} url - Page URL
 * @param {number|null} parentPageId - Parent page ID (null for seed)
 * @returns {Object} - { success: boolean, pageId: number, childUrls: string[] }
 */
async function processAndIndexPage(url, parentPageId = null) {
  try {
    // Check if URL already exists in index
    const existingPageId = await db.getPageIdByUrl(url);
    
    let storedLastModified = null;
    let headLastModified = null;
    
    if (existingPageId !== null) {
      storedLastModified = await db.getLastModified(existingPageId);
      const headResult = await checkHeadRequest(url);
      headLastModified = headResult.lastModified;
      
      if (headLastModified && storedLastModified) {
        const storedDate = new Date(storedLastModified);
        const headDate = new Date(headLastModified);
        if (headDate <= storedDate) {
          state.skipped++;
          console.log(`  [SKIP] ${url} (not modified)`);
          // Per Q&A: children only from fetched pages — return empty
          return { success: true, pageId: existingPageId, childUrls: [], skipped: true };
        }
      }
      
      // Cannot confirm page unchanged (head date unknown) — must re-fetch
      if (!headLastModified) {
        console.log(`  [UPDATE] ${url} (no server date — re-fetching)`);
      }
    }
    
    // Fetch the page
    console.log(`  [FETCH] ${url}`);
    const { html, lastModified, contentLength } = await fetchPage(url);
    
    // Process the page
    const pageData = processPage(html, url, lastModified, contentLength);
    
    let pageId;
    
    if (existingPageId !== null) {
      const existingForward = await db.getForwardIndex(existingPageId);
      const wordIds = existingForward.map(e => e.wordId);
      await db.clearPageFromInvertedIndex(existingPageId, wordIds);
      pageId = existingPageId;
    } else {
      // Create new page ID
      pageId = await db.getNextPageId();
      await db.incrementTotalDocuments(1);
    }

    // Store URL mapping
    await db.storeUrlMapping(pageId, url);
    
    // Store page metadata
    await db.storePageData(pageId, {
      title: pageData.title,
      url: pageData.url,
      lastModified: pageData.lastModified,
      size: pageData.size
    });
    
    // Index page content
    await indexPage(pageId, pageData);
    
    // Store parent-child relationship (parent → this page)
    if (parentPageId !== null) {
      await db.addLink(parentPageId, pageId);
    }
    
    // Store child links for pages already indexed
    for (const childUrl of pageData.links) {
      const childId = await db.getPageIdByUrl(childUrl);
      if (childId !== null) {
        await db.addLink(pageId, childId);
      }
      // For new URLs, link will be created when they're processed (via parentPageId)
    }
    
    state.crawled++;
    
    return {
      success: true,
      pageId,
      childUrls: pageData.links,
      skipped: false
    };
  } catch (e) {
    console.error(`  [ERROR] ${url}: ${e.message}`);
    state.errors++;
    return { success: false, pageId: null, childUrls: [], skipped: false };
  }
}

/**
 * Main BFS crawl function
 * @param {Object} options - Crawl options
 * @returns {Object} - Crawl statistics
 */
export async function crawl(options = {}) {
  const seedUrl = options.seedUrl || CONFIG.crawler.seedUrl;
  const maxPages = options.maxPages || CONFIG.crawler.maxPages;
  
  console.log(`\n=== COMP4321 Spider Starting ===`);
  console.log(`Seed URL: ${seedUrl}`);
  console.log(`Max pages: ${maxPages}`);
  
  // Initialize database
  await db.openDB();
  
  // Load stopwords
  loadStopwords();
  
  // Reset state
  state.queue = [seedUrl];
  state.visited = new Set();
  state.crawled = 0;
  state.skipped = 0;
  state.errors = 0;
  state.domain = getDomain(seedUrl);
  
  // Track page IDs for link relationships
  const urlToPageId = new Map();
  
  // BFS loop
  while (state.queue.length > 0 && (state.crawled + state.skipped) < maxPages) {
    const url = state.queue.shift();
    
    // Skip if already visited in this session
    if (state.visited.has(url)) {
      continue;
    }
    state.visited.add(url);
    
    // Skip if not same domain
    if (!isSameDomain(url)) {
      continue;
    }
    
    // Get parent page ID (for link relationship)
    // In BFS, we track which page discovered each URL
    const parentPageId = urlToPageId.has(url) ? urlToPageId.get(url) : null;
    
    // Process the page
    const result = await processAndIndexPage(url, parentPageId);
    
    if (result.success) {
      urlToPageId.set(url, result.pageId);
      
      // Add child URLs to queue (BFS expansion) — even for skipped pages
      for (const childUrl of result.childUrls) {
        if (!state.visited.has(childUrl) && isSameDomain(childUrl)) {
          state.queue.push(childUrl);
          // Track which page discovered this URL (store the parent's pageId)
          if (!urlToPageId.has(childUrl)) {
            urlToPageId.set(childUrl, result.pageId);
          }
        }
      }
      
      // Delay between requests (only for newly fetched pages)
      if (!result.skipped) {
        await sleep(CONFIG.crawler.requestDelay);
      }
    }
    
    // Progress update
    const total = state.crawled + state.skipped;
    if (total % 5 === 0 || total >= maxPages) {
      console.log(`\nProgress: ${total}/${maxPages} pages (crawled: ${state.crawled}, skipped: ${state.skipped}, errors: ${state.errors})`);
    }
  }
  
  console.log(`\n=== Crawl Complete ===`);
  console.log(`Total processed: ${state.crawled + state.skipped}`);
  console.log(`  Crawled: ${state.crawled}`);
  console.log(`  Skipped: ${state.skipped}`);
  console.log(`  Errors: ${state.errors}`);
  console.log(`  Queue remaining: ${state.queue.length}`);
  
  // Get database stats
  const stats = await db.getDBStats();
  console.log(`\nDatabase stats:`);
  console.log(`  Total pages indexed: ${stats.totalPages}`);
  console.log(`  Next page ID: ${stats.nextPageId}`);
  console.log(`  Next word ID: ${stats.nextWordId}`);

  if (state.crawled > 0) {
    console.log(`\nPre-computing word frequencies...`);
    const freqCount = await db.precomputeWordFrequencies();
    console.log(`  ${freqCount} word frequencies cached.`);

    console.log(`\nComputing PageRank...`);
    const prResult = await db.computePageRank();
    console.log(`  Iterations: ${prResult.iterations}, Converged: ${prResult.converged}`);
  }

  return {
    crawled: state.crawled,
    skipped: state.skipped,
    errors: state.errors,
    totalPages: stats.totalPages
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--seed-url':
        options.seedUrl = args[++i];
        break;
      case '--max-pages':
        options.maxPages = parseInt(args[++i], 10);
        if (isNaN(options.maxPages) || options.maxPages < 1) {
          console.error('Error: --max-pages must be a positive integer');
          process.exit(1);
        }
        break;
      case '--backup':
        options.seedUrl = CONFIG.crawler.backupUrl;
        console.log('Using backup seed URL:', options.seedUrl);
        break;
      case '--help':
        console.log('Usage: node src/crawler/spider.js [options]');
        console.log('Options:');
        console.log('  --seed-url <url>   Override the seed URL');
        console.log('  --max-pages <n>    Override the max pages (default: 300)');
        console.log('  --backup           Use the backup seed URL from config');
        console.log('  --help             Show this help message');
        process.exit(0);
        break;
      default:
        if (args[i].startsWith('--')) {
          console.error(`Unknown option: ${args[i]}`);
          console.error('Use --help for usage information');
          process.exit(1);
        }
    }
  }
  
  return options;
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('spider.js')) {
  const cliOptions = parseArgs();
  crawl(cliOptions)
    .then(() => process.exit(0))
    .catch(e => {
      console.error('Fatal error:', e);
      process.exit(1);
    });
}

export default { crawl };

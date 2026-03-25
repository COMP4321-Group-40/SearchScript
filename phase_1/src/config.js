// COMP4321 Search Engine Configuration

export const CONFIG = {
  // Crawler settings
  crawler: {
    seedUrl: 'https://www.cse.ust.hk/~kwtleung/COMP4321/testpage.htm',
    backupUrl: 'https://hitcslj.github.io/TestPages/testpage.htm',
    maxPages: 30, // Phase 1: 30 pages
    requestTimeout: 15000, // 15 seconds
    requestDelay: 10, // 10ms delay between requests
    userAgent: 'COMP4321-SearchEngine/1.0',
    maxRetries: 3
  },

  // Database settings
  database: {
    path: './data/searchdb',
    valueEncoding: 'json'
  },

  // Indexer settings
  indexer: {
    stopwordsFile: './stopwords.txt',
    maxKeywords: 10, // Top 10 frequent words per page
    minWordLength: 2, // Minimum word length to index
    maxWordLength: 50 // Maximum word length to index
  },

  // Search settings
  search: {
    maxResults: 50,
    titleBoost: 3.0, // Title match weight multiplier
    defaultTfScheme: 'log' // 'raw', 'log', 'augmented'
  },

  // Web interface settings
  web: {
    port: 3000,
    title: 'COMP4321 Search Engine'
  }
};

// DB Key prefixes
export const KEYS = {
  URL_TO_ID: 'url:map:',
  ID_TO_URL: 'url:id:',
  PAGE_DATA: 'page:',
  WORD_TO_ID: 'word:map:',
  ID_TO_WORD: 'word:id:',
  FORWARD_INDEX: 'forward:',
  INVERTED_INDEX: 'inverted:',
  TITLE_WORDS: 'title:words:',
  CHILDREN: 'links:children:',
  PARENTS: 'links:parents:',
  STATS_FREQ: 'stats:freq:',
  COUNTERS: 'meta:counters'
};

// Initialize counter structure
export const INITIAL_COUNTERS = {
  nextPageId: 1,
  nextWordId: 1
};

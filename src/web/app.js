/**
 * COMP4321 Search Engine - Web Interface
 * Express.js server with EJS templates for search UI.
 */

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';
import { search, parseQuery } from '../search/engine.js';
import { loadStopwords, getStopwords } from '../indexer/tokenizer.js';
import db from '../storage/db.js';
import { formatDate } from '../utils/helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Static files
app.use(express.static(join(__dirname, 'public')));

// Parse form data
app.use(express.urlencoded({ extended: true }));

// Home page - search form
app.get('/', (req, res) => {
  res.render('index', {
    title: CONFIG.web.title,
    query: '',
    results: null,
    error: null,
    searchTime: null
  });
});

// Search endpoint
app.get('/search', async (req, res) => {
  const query = req.query.q || '';

  if (!query.trim()) {
    return res.render('index', {
      title: CONFIG.web.title,
      query: '',
      results: null,
      error: null,
      searchTime: null
    });
  }

  try {
    const start = Date.now();
    const results = await search(query);
    const searchTime = Date.now() - start;

    // Format results for display
    const formattedResults = results.map(r => ({
      ...r,
      lastModifiedFormatted: formatDate(r.lastModified),
      keywords: r.keywords || [],
      childUrls: r.childUrls || [],
      parentUrls: r.parentUrls || []
    }));

    res.render('index', {
      title: CONFIG.web.title,
      query,
      results: formattedResults,
      resultCount: formattedResults.length,
      error: null,
      searchTime
    });
  } catch (e) {
    console.error('Search error:', e);
    res.render('index', {
      title: CONFIG.web.title,
      query,
      results: null,
      error: `Search failed: ${e.message}`,
      searchTime: null
    });
  }
});

// POST search (from form submission)
app.post('/search', async (req, res) => {
  const query = req.body.q || '';
  res.redirect(`/search?q=${encodeURIComponent(query)}`);
});

// ============================================
// API ENDPOINTS (for AJAX / bonus features)
// ============================================

// AJAX search endpoint
app.get('/api/search', async (req, res) => {
  const query = req.query.q || '';
  if (!query.trim()) {
    return res.json({ query: '', results: [], resultCount: 0, searchTime: 0, parsedQuery: { terms: [], phrases: [], excludeTerms: [] } });
  }
  try {
    const start = Date.now();
    const results = await search(query);
    const searchTime = Date.now() - start;
    const parsed = parseQuery(query);
    const formatted = results.map(r => ({
      ...r,
      lastModifiedFormatted: formatDate(r.lastModified)
    }));
    res.json({
      query,
      results: formatted,
      resultCount: formatted.length,
      searchTime,
      parsedQuery: parsed
    });
  } catch (e) {
    console.error('API search error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Get paginated keyword list
app.get('/api/keywords', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const letter = (req.query.letter || '').toUpperCase();
    const perPage = 50;
    const sortBy = req.query.sort === 'freq' ? 'freq' : 'alpha';

    if (getStopwords().size === 0) loadStopwords();
    const stopwords = getStopwords();
    const allWords = await db.getAllWords();

    const validWords = allWords.filter(w => !stopwords.has(w.word));

    const withFreq = await Promise.all(
      validWords.map(async w => ({
        wordId: w.wordId,
        word: w.word,
        pageCount: await db.getWordFrequency(w.wordId)
      }))
    );

    if (sortBy === 'alpha') {
      withFreq.sort((a, b) => a.word.localeCompare(b.word));
    } else {
      withFreq.sort((a, b) => b.pageCount - a.pageCount);
    }

    const letters = [...new Set(validWords.map(w => w.word.charAt(0).toUpperCase()))].sort();

    let filtered = withFreq;
    if (letter && letter !== 'ALL') {
      filtered = withFreq.filter(w => w.word.charAt(0).toUpperCase() === letter);
    }

    const total = filtered.length;
    const start = (page - 1) * perPage;
    const pageWords = filtered.slice(start, start + perPage);

    res.json({
      keywords: pageWords,
      total,
      page,
      perPage,
      letters: ['ALL', ...letters],
      currentLetter: letter || 'ALL',
      sortBy
    });
  } catch (e) {
    console.error('API keywords error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Start server
const port = CONFIG.web.port || 3000;

async function startServer() {
  // Initialize database and stopwords
  await db.openDB();
  loadStopwords();

  app.listen(port, () => {
    console.log(`\n=== COMP4321 Search Engine ===`);
    console.log(`Web interface running at http://localhost:${port}`);
    console.log(`Press Ctrl+C to stop.\n`);
  });
}

// Global error handler — catches all errors from route handlers
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (!res.headersSent) {
    res.status(500).render('index', {
      title: CONFIG.web.title,
      query: req.query.q || '',
      results: null,
      error: 'An error occurred while processing your request.',
      searchTime: null
    });
  }
});

// 404 handler — catch-all for unknown routes
app.use((req, res) => {
  res.status(404).render('index', {
    title: CONFIG.web.title,
    query: req.query.q || '',
    results: null,
    error: 'Page not found',
    searchTime: null
  });
});

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('app.js')) {
  startServer().catch(e => {
    console.error('Failed to start server:', e);
    process.exit(1);
  });
}

export default app;

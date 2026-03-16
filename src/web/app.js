/**
 * COMP4321 Search Engine - Web Interface
 * Express.js server with EJS templates for search UI.
 */

import express from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';
import { search } from '../search/engine.js';
import { loadStopwords } from '../indexer/tokenizer.js';
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

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('app.js')) {
  startServer().catch(e => {
    console.error('Failed to start server:', e);
    process.exit(1);
  });
}

export default app;

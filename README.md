# COMP4321 Search Engine

A web-based search engine built with Node.js, implementing a full crawl-index-search pipeline. Developed as a course project for COMP4321 (Information Retrieval and Web Search) at HKUST.

## Setup & Running

**Step 1 — Install dependencies:**

```bash
npm install
```

**Step 2 — Crawl and index pages:**

```bash
npm run crawl
```

This fetches up to 300 pages starting from the seed URL and builds the search index. The crawl uses **incremental updates** — pages already in the database are only re-fetched if the server reports a newer `last-modified` date. On the first run, all pages are indexed. Subsequent runs are faster as only changed pages are re-fetched.

> **Important:** `npm run serve` will start with an empty database if crawl has not been run yet.

**Step 3 — Start the web interface:**

```bash
npm run serve      # http://localhost:3000
```

**Step 4 — Generate spider_result.txt (optional):**

```bash
npm run generate
```

Outputs all indexed pages to `spider_result.txt`.

> **Prerequisites:** Node.js v18 or higher.

## Search Interface

The web interface at `http://localhost:3000` provides:

- **Search box** — enter queries with phrase and exclusion support
- **Left sidebar** — Keyword Browser for browsing indexed terms
- **Right sidebar** — Query History showing recent searches
- **Result cards** — ranked results with score, title, URL, meta, and keywords
- **"Get Similar" button** — click to find similar pages via relevance feedback

Both sidebars stay fixed while scrolling through results.

## Query Syntax

| Format | Example | Description |
|--------|---------|-------------|
| Single term | `machine` | Search for pages containing "machine" |
| Multiple terms | `machine learning` | AND search — pages containing both terms |
| Exact phrase | `"machine learning"` | Pages where words appear consecutively |
| Exclude term | `python -java` | Pages about Python but not Java |

Terms are **stemmed** before matching (e.g., "machines" → "machine"). Common **stopwords** are excluded from search.

## Project Structure

```
src/
├── config.js              # Configuration (URLs, limits, DB key prefixes)
├── crawler/
│   ├── spider.js          # BFS crawler with HEAD check and incremental updates
│   └── pageProcessor.js   # HTML parsing with Cheerio
├── indexer/
│   ├── porterStemmer.js   # Porter Stemming Algorithm (steps 1a–5b, from scratch)
│   └── tokenizer.js        # Tokenization, stopword filtering, TF calculation
├── search/
│   └── engine.js          # VSM retrieval with cosine similarity
├── storage/
│   └── db.js              # LevelDB storage layer (25 functions, 12 key prefixes)
├── web/
│   ├── app.js             # Express server with REST API endpoints
│   ├── views/index.ejs    # Search interface (EJS + vanilla JS SPA)
│   └── public/style.css   # Stylesheet
├── test/
│   └── generateResult.js  # Generates spider_result.txt
└── utils/
    └── helpers.js         # Utility functions (date formatting, etc.)
```

## Technical Architecture

### Crawling (`src/crawler/spider.js`)

The spider uses **breadth-first search** (BFS) to discover pages:

1. **HEAD Request Check** — Before fetching a page, an HTTP HEAD request checks the `last-modified` header. Skips the full GET request if the page hasn't changed.
2. **Incremental Updates** — Existing pages are only re-fetched if their `last-modified` date is newer than stored. Stale inverted index entries are cleared before re-indexing.
3. **Visited Set** — A `Set` tracks all visited URLs to prevent re-processing and handle cyclic links.
4. **Domain Restriction** — Only pages within the same domain as the seed URL are crawled.
5. **Page-ID Mapping** — Each URL is assigned a unique integer page ID. Bidirectional tables (`url:map:<url>` ↔ `url:id:<pageId>`) enable O(1) lookups.
6. **Rate Limiting** — Configurable delay (default 500ms) between requests.
7. **Retry Logic** — Failed requests (404s, timeouts) are retried up to 3 times.

### Storage (`src/storage/db.js`)

LevelDB key-value store with 12 key prefixes:

| Key Prefix | Value | Purpose |
|------------|-------|---------|
| `url:map:<url>` | `pageId` | URL → Page ID |
| `url:id:<pageId>` | `url` | Page ID → URL |
| `page:<pageId>` | `{title, url, lastModified, size}` | Page metadata |
| `word:map:<word>` | `wordId` | Stemmed word → Word ID |
| `word:id:<wordId>` | `word` | Word ID → Stemmed word |
| `forward:<pageId>` | `[{wordId, tf, positions[]}]` | Forward index (terms per document) |
| `inverted:<wordId>` | `[{pageId, tf}]` | Inverted index (documents per term) |
| `title:words:<pageId>` | `[{wordId, positions[]}]` | Title words (separate from body) |
| `links:children:<pageId>` | `[childPageId, ...]` | Child links (outgoing) |
| `links:parents:<pageId>` | `[parentPageId, ...]` | Parent links (incoming) |
| `stats:freq:<pageId>` | `[{word, freq}]` | Top 10 keywords per page |
| `meta:counters` | `{nextPageId, nextWordId}` | Auto-increment counters |

Title words and body words are stored **separately**, enabling efficient title-match detection and boosting.

### Indexing Pipeline (`src/indexer/`)

1. **Tokenization** — Lowercase, split on non-alphanumeric, filter by length (2–50 chars).
2. **Stopword Removal** — 423 unique English stopwords loaded into a `Set` for O(1) lookup.
3. **Stemming** — Porter Stemming Algorithm steps 1a through 5b, implemented from scratch.
4. **Forward Index** — Stores all stemmed terms per page with TF and word positions.
5. **Inverted Index** — Stores all page IDs per term with TF.

### Retrieval (`src/search/engine.js`)

Vector Space Model with **cosine similarity**:

- **Term Weight**: `tf-idf(t, d) = (tf / max(tf)) × log₂(N / df)`
- **Cosine Similarity**: `cosine(q, d) = (q · d) / (||q|| × ||d||)`
- **Title Boost**: Matches in the title field receive a 3.0× multiplier
- **Phrase Matching**: Quoted phrases checked for consecutive word positions in title and body; title phrase matches receive a 5.0 × titleBoost bonus

### Porter Stemmer (`src/indexer/porterStemmer.js`)

Full implementation of the Porter (1980) algorithm, steps 1a–5b, from scratch:

| Step | Description | Example |
|------|-------------|---------|
| 1a | Plurals (`sses`, `ies`, `ss`, `s`) | `cats` → `cat` |
| 1b | `-eed`, `-ed`, `-ing` | `running` → `run` |
| 1c | `-y` → `-i` if stem has vowel | `happy` → `happi` |
| 2 | Double suffixes | `relational` → `relate` |
| 3 | `-ic-`, `-full`, `-ness` | `activate` → `activ` |
| 4 | `-ant`, `-ence`, `-er`, etc. | `digital` → `digit` |
| 5a/5b | Final `-e`, double consonant | `rate` → `rat` |

Key helpers: `isConsonant()`, `measure()`, `hasVowel()`, `endsDoubleConsonant()`, `endsCVC()`.

## Bonus Features

### 1. Excluded Terms
Terms prefixed with `-` are excluded from results. The excluded term is stemmed and matched against each page's forward index. Example: `python -java` returns pages containing "python" but not "java".

### 2. Exact Phrase Search
Quoted strings match exact word sequences. Positions are checked in both title and body; consecutive matching words boost the score significantly. Example: `"machine learning"` finds pages where these words appear side by side.

### 3. AJAX Web Interface
The search interface uses `fetch` API for instant results without page reloads. Features: loading spinner, parsed query display, smooth fade-in animations, hover effects, and responsive layout.

### 4. Keyword Browser
The left sidebar lists all stemmed keywords in the database:
- A-Z letter filter buttons
- Sort toggle: **A-Z** (alphabetical, default) or **Freq** (by page frequency)
- Paginated (50 per page)
- Click any keyword to add it to the search box
- Shows page frequency for each keyword

### 5. Query History
The right sidebar tracks recent searches in `sessionStorage` (up to 20 entries). Click any entry to re-run that search. "Clear" button to wipe history.

### 6. Get Similar Pages (Relevance Feedback)
Each result card has a "Similar" button that implements Rocchio-style pseudo relevance feedback: extracts the top 5 most frequent keywords from the result, reformulates the query, and auto-submits.

### 7. REST API
The server exposes JSON endpoints for programmatic access:

| Endpoint | Description |
|----------|-------------|
| `GET /api/search?q=<query>` | Returns JSON with results, scores, parsed query, and search time |
| `GET /api/keywords?letter=A&page=1&sort=freq` | Paginated keyword list |

## Constraints

- No external search APIs or high-level NLP libraries (no Lucene, `natural`, or ElasticSearch)
- Porter Stemmer and stopword filtering implemented from scratch
- Cyclic links handled via visited set
- Maximum 300 pages indexed
- Incremental updates mandatory — rebuilding from scratch is forbidden

# COMP4321 Search Engine — Phase 1 Report

## 1. System Design Overview

The Phase 1 implementation consists of two main components:

1. **Spider (Crawler)**: Recursively fetches web pages using breadth-first search (BFS) from a given seed URL, up to a configurable page limit.
2. **Indexer**: Processes fetched pages to extract keywords using stopword filtering and stemming, then stores them in a LevelDB database.

Both components are integrated — the spider calls the indexer as each page is fetched.

## 2. LevelDB Database Schema

LevelDB is used as the key-value store (replacing JDBM from the Java specification). The schema uses string-prefixed keys to namespace different data types.

### 2.1 URL ↔ Page-ID Mapping

Two tables maintain bidirectional mapping between URLs and integer page IDs:

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `url:map:<url>` | `pageId` (integer) | Given a URL, retrieve its page ID |
| `url:id:<pageId>` | `url` (string) | Given a page ID, retrieve its URL |

**Design Rationale**: All other tables reference page IDs (not URLs) for compactness and consistency. The bidirectional mapping enables efficient lookups in both directions — the spider needs URL→ID when storing data, while the result generator needs ID→URL for output.

### 2.2 Word ↔ Word-ID Mapping

Similar bidirectional mapping for stemmed words:

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `word:map:<stemmed_word>` | `wordId` (integer) | Stemmed word → Word ID |
| `word:id:<wordId>` | `stemmed_word` (string) | Word ID → Stemmed word |

### 2.3 Page Metadata

Stores per-page information required for result display:

| Key Pattern | Value |
|-------------|-------|
| `page:<pageId>` | `{title, url, lastModified, size}` |

### 2.4 Forward Index

Maps each page to its terms and their statistics:

| Key Pattern | Value |
|-------------|-------|
| `forward:<pageId>` | `[{wordId, tf, positions[]}]` |

- `wordId`: Reference to the stemmed word
- `tf`: Term frequency (number of occurrences)
- `positions[]`: Array of word positions in the document (for phrase search support)

### 2.5 Inverted Index

Maps each term to all pages containing it:

| Key Pattern | Value |
|-------------|-------|
| `inverted:<wordId>` | `[{pageId, tf}]` |

This is the primary structure for retrieval — given a query term, the inverted index returns all matching documents with their term frequencies.

### 2.6 Title Index

Stores word positions specifically for page titles (separate from body):

| Key Pattern | Value |
|-------------|-------|
| `title:words:<pageId>` | `[{wordId, positions[]}]` |

**Design Rationale**: Title matches should receive higher weight during retrieval. Storing title words separately enables efficient title-match detection without re-parsing.

### 2.7 Link Relations

Stores parent/child page relationships:

| Key Pattern | Value |
|-------------|-------|
| `links:children:<pageId>` | `[childPageId, ...]` |
| `links:parents:<pageId>` | `[parentPageId, ...]` |

**Functionality**: `getChildren(pageId)` and `getParents(pageId)` provide efficient retrieval of link relationships. Both directions are stored to support bidirectional queries.

### 2.8 Statistics

Stores pre-computed keyword frequencies for display:

| Key Pattern | Value |
|-------------|-------|
| `stats:freq:<pageId>` | `[{word, freq}]` (top 10) |

### 2.9 Counters

Tracks auto-incrementing IDs:

| Key | Value |
|-----|-------|
| `meta:counters` | `{nextPageId, nextWordId}` |

## 3. Spider Design

### 3.1 BFS Strategy

The spider uses a breadth-first search (BFS) queue to crawl pages:

1. Start with the seed URL in the queue
2. For each URL dequeued:
   - Skip if already visited (handles cyclic links)
   - Skip if outside the seed domain
   - Perform HEAD request to check last-modified date
   - If page exists in DB and hasn't changed, skip full fetch
   - Otherwise, fetch and process the page
   - Extract all hyperlinks and add to queue
3. Continue until 300 pages are processed

### 3.2 Efficiency: HEAD Request Check

Before fetching a page's full content, the spider performs an HTTP HEAD request to check the `last-modified` header:

```
HEAD request → Compare last-modified with stored value
  ├── If unchanged → Skip full GET request
  └── If changed or new → Proceed with full GET request
```

This avoids re-downloading pages that haven't changed since the last crawl, significantly reducing bandwidth and processing time on subsequent runs.

### 3.3 Cyclic Link Handling

Two mechanisms prevent infinite loops:

1. **Visited Set**: A `Set` tracks all URLs processed in the current session. Before processing any URL, the spider checks if it's already in the visited set.
2. **Domain Restriction**: Only pages within the same domain as the seed URL are crawled, preventing the spider from following external links.

### 3.4 Page Processing Pipeline

For each fetched page:

1. Parse HTML using Cheerio
2. Extract title (from `<title>` tag, with fallback to `<h1>`)
3. Extract body text (removing `<script>`, `<style>`, `<nav>`, etc.)
4. Extract all hyperlinks (resolving relative URLs, removing fragments)
5. Calculate page size (word count)
6. Tokenize text → filter stopwords → apply Porter stemming
7. Compute term frequencies and identify top 10 keywords
8. Store all data in LevelDB

## 4. Indexer Design

### 4.1 Stopword Filtering

The tokenizer module (`src/indexer/tokenizer.js`) implements stopword filtering from scratch:

- Loads 429 English stopwords from `stopwords.txt` into a `Set` for O(1) lookup
- Each token is checked against the stopword set during text processing
- No external NLP libraries are used

### 4.2 Porter Stemming Algorithm

The stemmer module (`src/indexer/porterStemmer.js`) implements the full Porter Stemming Algorithm:

- **Step 1a**: Plurals (`sses` → `ss`, `ies` → `i`, `ss` → `ss`, `s` → ∅)
- **Step 1b**: `-eed`, `-ed`, `-ing` suffixes
- **Step 1c**: `y` → `i` if stem has a vowel
- **Step 2**: Double suffixes (`ational` → `ate`, `tional` → `tion`, etc.)
- **Step 3**: `-ic-`, `-full`, `-ness`, etc.
- **Step 4**: `-ant`, `-ence`, `-er`, `-ic`, etc.
- **Step 5a**: Remove final `-e` if measure > 1
- **Step 5b**: Remove trailing double consonant if measure > 1

Helper functions compute consonant/vowel patterns and VC (vowel-consonant) sequence measures.

### 4.3 Inverted Index Construction

As each page is indexed:

1. Each stemmed word is assigned a unique word ID (or retrieved if already exists)
2. The forward index stores `{wordId, tf, positions}` for the page
3. The inverted index is updated by adding a posting `{pageId, tf}` for each word
4. Title words are stored separately with their positions

## 5. spider_result.txt Format

The test program (`src/test/generateResult.js`) reads all indexed data from LevelDB and outputs a plain-text file with the following format per page:

```
Page title
URL
Last modification date, size of page
Keyword1 freq1; Keyword2 freq2; Keyword3 freq3; ...
Child Link1
Child Link2
...
```

- Keywords: Up to 10 most frequent stemmed words with their frequencies
- Child Links: Up to 10 child page URLs
- Blank line separates each page entry

## 6. File Structure

```
src/
├── config.js              # Configuration constants and DB key prefixes
├── crawler/
│   ├── spider.js          # BFS crawler with HEAD check and visited set
│   └── pageProcessor.js   # HTML parsing, link extraction, text processing
├── indexer/
│   ├── porterStemmer.js   # Porter Stemming Algorithm (from scratch)
│   └── tokenizer.js       # Tokenization, stopword filtering, TF calculation
├── storage/
│   └── db.js              # LevelDB storage layer with all CRUD operations
├── test/
│   └── generateResult.js  # Generates spider_result.txt from database
└── utils/
    └── helpers.js         # Sleep, date formatting, string truncation
```

## 7. Known Limitations

- The crawler is rate-limited by design (500ms delay) to avoid overwhelming servers
- Pages without `last-modified` headers use the current time as default
- The size field uses word count (not byte count) as specified

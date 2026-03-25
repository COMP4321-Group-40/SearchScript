# COMP4321 Search Engine — Phase 1

Spider (Crawler) and Indexer for COMP4321 course project.

## Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)

## Installation

```bash
npm install
```

## Project Structure

```
phase_1/
├── package.json          # npm scripts
├── stopwords.txt        # 429 English stopwords
├── spider_result.txt    # Test output (generated)
├── data/searchdb/       # LevelDB database (created on first crawl)
└── src/
    ├── config.js         # Configuration
    ├── crawler/
    │   ├── spider.js      # BFS crawler + indexer integration
    │   └── pageProcessor.js # HTML parsing, link extraction
    ├── indexer/
    │   ├── porterStemmer.js # Porter Stemming Algorithm
    │   └── tokenizer.js    # Tokenization + stopword filtering
    ├── storage/
    │   └── db.js          # LevelDB storage layer
    ├── test/
    │   └── generateResult.js # Generates spider_result.txt
    └── utils/
        └── helpers.js     # Utility functions
```

## Running

### 1. Crawl and Index Pages

Crawl up to 30 pages starting from the seed URL:

```bash
npm run crawl
```

This will:
1. Start BFS crawling from the seed URL (`https://hitcslj.github.io/TestPages/testpage.htm`) 
and backup URL (`https://hitcslj.github.io/TestPages/testpage.htm`) both of which can be modified in config.js
2. For each page: fetch HTML, extract title, extract body text, extract links
3. Process text: tokenize → filter stopwords → apply Porter stemming
4. Store in LevelDB: URL↔ID mapping, page metadata, forward index, inverted index, title words, parent/child links, keyword statistics
5. Use incremental updates — pages already in the database are only re-fetched if the server reports a newer `last-modified` date

### 2. Generate spider_result.txt

Output all indexed pages to a plain-text test file:

```bash
npm run generate
```

The output format per page:

```
Page title
URL
Last modification date, size of page (word count)
Keyword1 freq1; Keyword2 freq2; ... (up to 10)
Child link 1
Child link 2
...
-------------------------------------------------------------------------------
```

## Technical Design

### BFS Crawling

1. **Queue-based BFS**: Iterative breadth-first traversal
2. **HEAD Request Check**: Before fetching, sends HTTP HEAD to check `last-modified`. Skips unchanged pages.
3. **Incremental Updates**: Re-fetches only if server date is newer than stored. Clears stale inverted index entries before re-indexing.
4. **Visited Set**: Prevents re-processing and cyclic links
5. **Domain Restriction**: Only crawls pages within the same domain as the seed URL
6. **Retry Logic**: Failed requests (404s, timeouts) retried up to 3 times
7. **Rate Limiting**: 10ms delay between requests

### LevelDB Schema

| Key Prefix | Value | Purpose |
|------------|-------|---------|
| `url:map:<url>` | `pageId` | URL → Page ID |
| `url:id:<pageId>` | `url` | Page ID → URL |
| `page:<pageId>` | `{title, url, lastModified, size}` | Page metadata |
| `word:map:<word>` | `wordId` | Stemmed word → Word ID |
| `word:id:<wordId>` | `word` | Word ID → Stemmed word |
| `forward:<pageId>` | `[{wordId, tf, positions[]}]` | Forward index |
| `inverted:<wordId>` | `[{pageId, tf}]` | Inverted index |
| `title:words:<pageId>` | `[{wordId, positions[]}]` | Title word positions |
| `links:children:<pageId>` | `[childPageId, ...]` | Child links |
| `links:parents:<pageId>` | `[parentPageId, ...]` | Parent links |
| `stats:freq:<pageId>` | `[{word, freq}]` | Top 10 keywords |
| `meta:counters` | `{nextPageId, nextWordId}` | Auto-increment counters |

### Indexing Pipeline

1. **Tokenization**: Lowercase, split on non-alphanumeric characters
2. **Stopword Removal**: 429 English stopwords filtered via `Set` lookup
3. **Stemming**: Porter Stemming Algorithm (steps 1a–5b)

### Porter Stemmer Examples

| Input | Output |
|-------|--------|
| `running` | `run` |
| `cats` | `cat` |
| `connection` | `connect` |
| `relational` | `relate` |
| `activate` | `activ` |
| `digital` | `digit` |

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run crawl` | Crawl and index up to 30 pages |
| `npm run generate` | Generate `spider_result.txt` |
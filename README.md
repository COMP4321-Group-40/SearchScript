# COMP4321 Search Engine

A web-based search engine built with Node.js, implementing a full crawl-index-search pipeline. Developed as a course project for COMP4321 (Information Retrieval and Web Search) at HKUST.

## Prerequisites

- **Node.js** v18 or higher
- **npm** (comes with Node.js)

## Installation

```bash
git clone https://github.com/COMP4321-Group-40/SearchScript.git
cd SearchScript
npm install
```

## Usage

### 1. Crawl and Index Pages

Crawl up to 300 pages starting from the seed URL and build the search index:

```bash
npm run crawl
```

The crawler uses incremental updates — pages already in the database are only re-fetched if the server reports a newer `last-modified` date.

### 2. Generate spider_result.txt

Output all indexed pages to a plain-text file:

```bash
npm run generate
```

### 3. Start the Web Interface

Launch the search interface on `http://localhost:3000`:

```bash
npm run serve
```

Enter queries in the search box. Use `"quotes"` for phrase search (e.g., `"hong kong"`).

## Project Structure

```
src/
├── config.js              # Configuration (URLs, limits, DB key prefixes)
├── crawler/
│   ├── spider.js          # BFS crawler with HEAD check and incremental updates
│   └── pageProcessor.js   # HTML parsing (Cheerio)
├── indexer/
│   ├── porterStemmer.js   # Porter Stemming Algorithm (from scratch)
│   └── tokenizer.js       # Stopword filtering and tokenization (from scratch)
├── search/
│   └── engine.js          # Vector Space Model with cosine similarity
├── storage/
│   └── db.js              # LevelDB storage layer
├── web/
│   ├── app.js             # Express.js server
│   ├── views/index.ejs    # Search interface template
│   └── public/style.css   # Stylesheet
├── test/
│   └── generateResult.js  # Generates spider_result.txt
└── utils/
    └── helpers.js         # Utility functions
```

## Technical Architecture

### BFS Crawling Strategy

The spider uses breadth-first search (BFS) to crawl web pages:

1. **HEAD Request Check**: Before fetching a page, an HTTP HEAD request checks the `last-modified` header. If the page hasn't changed since the last crawl, the full GET request is skipped.

2. **Incremental Updates**: Existing pages are only re-fetched if their `last-modified` date is newer than the stored value. Stale inverted index entries are cleared before re-indexing.

3. **Visited Set**: A `Set` tracks all visited URLs to prevent re-processing and handle cyclic links.

4. **Domain Restriction**: Only pages within the same domain as the seed URL are crawled.

5. **Page-ID Mapping**: Each URL is assigned a unique integer page ID. Two bidirectional tables (`URL_TO_ID` and `ID_TO_URL`) enable efficient lookups in both directions.

6. **Rate Limiting**: A configurable delay (default 500ms) between requests prevents overwhelming the server.

7. **Retry Logic**: Failed requests (404s, timeouts) are retried up to 3 times before skipping the page.

### LevelDB Schema Design

LevelDB is used as the key-value store (replacing JDBM). Keys are prefixed strings that namespace different data types:

| Key Prefix | Value | Purpose |
|------------|-------|---------|
| `url:map:<url>` | `pageId` | URL → Page ID lookup |
| `url:id:<pageId>` | `url` | Page ID → URL lookup |
| `page:<pageId>` | `{title, url, lastModified, size}` | Page metadata |
| `word:map:<word>` | `wordId` | Stemmed word → Word ID |
| `word:id:<wordId>` | `word` | Word ID → Stemmed word |
| `forward:<pageId>` | `[{wordId, tf, positions[]}]` | Forward index (terms per doc) |
| `inverted:<wordId>` | `[{pageId, tf}]` | Inverted index (docs per term) |
| `title:words:<pageId>` | `[{wordId, positions[]}]` | Title word positions (separate from body) |
| `links:children:<pageId>` | `[childPageId, ...]` | Child links |
| `links:parents:<pageId>` | `[parentPageId, ...]` | Parent links |
| `stats:freq:<pageId>` | `[{word, freq}]` | Top 10 keywords for display |
| `meta:counters` | `{nextPageId, nextWordId}` | Auto-increment counters |

**Two separate inverted files**: Title words and body words are stored separately, enabling efficient title-match detection and boosting.

### Indexing Pipeline

1. **Tokenization**: Text is lowercased and split on non-alphanumeric characters.
2. **Stopword Removal**: Common English words (429 stopwords) are filtered out using a from-scratch `Set` lookup.
3. **Stemming**: Words are reduced to their stem using a from-scratch implementation of the Porter Stemming Algorithm (steps 1a through 5b).
4. **Forward Index**: For each page, stores all stemmed terms with their term frequencies (tf) and word positions.
5. **Inverted Index**: For each term, stores all pages containing it with their term frequencies.

### Vector Space Model and Cosine Similarity

Retrieval uses the Vector Space Model with cosine similarity:

- **Term Weight**: `tf-idf(t, d) = (tf / max(tf)) × log₂(N / df(t))`
  - Max TF normalization scales term frequency relative to the most frequent term in the document
  - IDF penalizes terms that appear in many documents

- **Cosine Similarity**: `cosine(q, d) = (q · d) / (||q|| × ||d||)`
  - Query and document vectors are normalized by their L2 norms
  - Scores range from 0 (no similarity) to 1 (identical direction)

- **Title Boosting**: Title matches receive a configurable multiplier (default 3.0×) applied after normalization.

- **Phrase Search**: Quoted phrases (e.g., `"machine learning"`) are checked for consecutive word positions in both title and body, with a significant scoring boost for matches.

### Stopword Filtering

The `src/indexer/tokenizer.js` module implements stopword filtering from scratch:

- Loads 429 English stopwords from `stopwords.txt`
- Checks each token against the stopword `Set` during processing (O(1) lookup)
- No external NLP libraries are used

### Porter Stemming Algorithm

The `src/indexer/porterStemmer.js` module implements the full Porter Stemming Algorithm from scratch:

| Step | Description | Example |
|------|-------------|---------|
| 1a | Plurals (`sses`, `ies`, `ss`, `s`) | `cats` → `cat` |
| 1b | `-eed`, `-ed`, `-ing` | `running` → `run` |
| 1c | `-y` → `-i` if stem has vowel | `happy` → `happi` |
| 2 | Double suffixes | `relational` → `relate` |
| 3 | `-ic-`, `-full`, `-ness` | `activate` → `activ` |
| 4 | `-ant`, `-ence`, `-er`, etc. | `digital` → `digit` |
| 5a/5b | Final `-e`, double consonant | `rate` → `rat` |

Key helper functions: `isConsonant()`, `measure()`, `hasVowel()`, `endsDoubleConsonant()`, `endsCVC()`.

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm run crawl` | Crawl and index up to 300 pages (incremental: re-fetches only modified pages) |
| `npm run generate` | Generate `spider_result.txt` from the index |
| `npm run serve` | Start the web interface on port 3000 (localhost:3000) |

## Constraints

- No external search APIs or high-level NLP libraries (no Lucene, `natural`, or ElasticSearch)
- Porter Stemmer and stopword filtering implemented from scratch
- Cyclic links handled via visited set
- Maximum 300 pages indexed
- Incremental updates mandatory (rebuilding from scratch is forbidden)

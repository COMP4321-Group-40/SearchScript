# COMP4321 Search Engine — Final Phase Report

## 1. Overall System Design

The search engine follows a three-stage pipeline:

```
[Crawler] → [Indexer] → [Storage] → [Search Engine] → [Web Interface]
  BFS        Porter      LevelDB      Vector Space       Express.js
  +HEAD      Stemmer     Key-Value    Model + Cosine     + EJS
  +Cheerio   +Stopwords  Store        Similarity         Templates
```

### 1.1 Component Interaction

1. **Spider** fetches pages using BFS, checks last-modified dates via HEAD requests
2. **Page Processor** parses HTML, extracts title/body/links using Cheerio
3. **Tokenizer** processes text: tokenize → filter stopwords → stem words
4. **Storage Layer** persists all data in LevelDB with prefixed keys
5. **Search Engine** retrieves ranked results using Vector Space Model
6. **Web Server** presents results through an Express.js + EJS interface

## 2. File Structures and LevelDB Schema

### 2.1 Project Files

```
src/
├── config.js              # All configuration constants
├── crawler/
│   ├── spider.js          # BFS crawler, HEAD check, incremental updates
│   └── pageProcessor.js   # HTML parsing with Cheerio
├── indexer/
│   ├── porterStemmer.js   # Porter Stemming Algorithm (from scratch)
│   └── tokenizer.js       # Stopword filtering, tokenization (from scratch)
├── search/
│   └── engine.js          # Vector Space Model, cosine similarity
├── storage/
│   └── db.js              # LevelDB operations
├── web/
│   ├── app.js             # Express.js server
│   ├── views/index.ejs    # Search and results template
│   └── public/style.css   # Responsive stylesheet
├── test/
│   └── generateResult.js  # spider_result.txt generator
└── utils/
    └── helpers.js         # Utility functions

data/searchdb/             # LevelDB database files
stopwords.txt              # 429 English stopwords
spider_result.txt          # Generated test output
```

### 2.2 LevelDB Key Schema

All data is stored in a single LevelDB database with string-prefixed keys:

| Prefix | Value Type | Purpose |
|--------|-----------|---------|
| `url:map:<url>` | `pageId` | URL → Page ID |
| `url:id:<pageId>` | `url` | Page ID → URL |
| `page:<pageId>` | `{title, url, lastModified, size}` | Page metadata |
| `word:map:<word>` | `wordId` | Stemmed word → Word ID |
| `word:id:<wordId>` | `word` | Word ID → Stemmed word |
| `forward:<pageId>` | `[{wordId, tf, positions}]` | Forward index |
| `inverted:<wordId>` | `[{pageId, tf}]` | Inverted index |
| `title:words:<pageId>` | `[{wordId, positions}]` | Title word positions |
| `links:children:<pageId>` | `[pageId, ...]` | Child links |
| `links:parents:<pageId>` | `[pageId, ...]` | Parent links |
| `stats:freq:<pageId>` | `[{word, freq}]` | Top keywords |
| `meta:counters` | `{nextPageId, nextWordId}` | ID counters |

## 3. Algorithms

### 3.1 BFS Crawling

The spider uses breadth-first search with the following enhancements:

**Efficiency Check (HEAD Request)**:
```
For each URL in queue:
  1. Check if URL exists in DB
  2. If exists: send HEAD request, compare last-modified
     - If unchanged: skip GET, retrieve stored children for BFS
     - If changed: proceed with full GET
  3. If new: proceed with full GET
  4. Extract links → add unvisited same-domain URLs to queue
```

**Visited Set**: A `Set<string>` prevents re-processing URLs within a session.

**Domain Restriction**: Only URLs matching the seed URL's hostname are crawled.

### 3.2 Porter Stemming Algorithm

Implemented from scratch in `src/indexer/porterStemmer.js`. The algorithm applies suffix-stripping rules in 5 main steps:

| Step | Suffixes | Example |
|------|----------|---------|
| 1a | `-sses`, `-ies`, `-s` | `cats` → `cat` |
| 1b | `-eed`, `-ed`, `-ing` | `running` → `run` |
| 1c | `-y` (if vowel in stem) | `happy` → `happi` |
| 2 | `-ational`, `-tional`, `-izer`, etc. | `relational` → `relate` |
| 3 | `-icate`, `-ative`, `-alize`, etc. | `activate` → `activ` |
| 4 | `-al`, `-ance`, `-ence`, `-er`, etc. | `digital` → `digit` |
| 5 | `-e`, double consonant | `rate` → `rat` |

Key helper functions:
- `isConsonant(word, i)`: Checks if character at position is a consonant (including `y` logic)
- `measure(word)`: Counts VC (vowel-consonant) sequences
- `endsCVC(word)`: Checks consonant-vowel-consonant ending pattern

### 3.3 Stopword Filtering

The `src/indexer/tokenizer.js` module:
1. Loads 429 stopwords from `stopwords.txt` into a `Set`
2. During tokenization, each word is checked with `O(1)` lookup
3. Matching tokens are excluded from indexing

### 3.4 Title Match Boosting

Title matches receive higher weight than body matches:

```
titleWeight = bodyWeight × titleBoost (default 3.0)
```

Implementation in search engine:
- For each query term found in a document's title, the score contribution is multiplied by the title boost factor
- Phrase matches in title receive both the phrase boost and title boost

### 3.5 Vector Space Model with Cosine Similarity

**Term Weighting**:
```
tf-idf(t, d) = (tf(t,d) / max_tf(d)) × log₂(N / df(t))
```
- Max TF normalization scales term frequency relative to the most frequent term in the document
- IDF (`log₂(N/df)`) penalizes terms that appear in many documents

**Cosine Similarity**:
```
cosine(q, d) = (q · d) / (||q|| × ||d||)
```
- Query vector: `q_i = idf(t_i)` for each query term
- Document vector: `d_i = tf-idf(t_i, d)` for each term in document
- Both vectors are normalized by their L2 norms

**Phrase Search**:
1. Quoted phrases are extracted from the query (e.g., `"hong kong"`)
2. For each candidate document, check if phrase tokens appear in consecutive positions
3. Phrase matches receive a significant scoring boost (5.0×)

## 4. Installation Procedure

```bash
# 1. Clone the repository
git clone <repository-url>
cd SearchSpider

# 2. Install dependencies
npm install

# 3. Crawl and index pages (up to 300)
npm run crawl

# 4. Generate spider_result.txt
npm run generate

# 5. Start the web interface
npm run serve
# Open http://localhost:3000 in a browser
```

## 5. Feature Highlights

### Core Features

| Feature | Description |
|---------|-------------|
| BFS Crawling | Breadth-first traversal with domain restriction |
| HEAD Check | Avoids re-downloading unchanged pages |
| Cyclic Link Handling | Visited set prevents infinite loops |
| Porter Stemming | Full algorithm implemented from scratch |
| Stopword Filtering | 429 stopwords, from-scratch implementation |
| Vector Space Model | tf-idf weighting with cosine similarity |
| Title Boosting | 3.0× weight multiplier for title matches |
| Phrase Search | Quoted phrase support with consecutive position check |
| Parent/Child Links | Bidirectional link relationship storage |
| Web Interface | Clean search UI with ranked results |

### Beyond Required Specification

1. **Responsive UI**: The web interface adapts to different screen sizes
3. **Score Display**: Relevance scores are shown for each result
4. **Keyword Display**: Top 5 stemmed keywords with frequencies shown per result
5. **Separate Title Index**: Title words are indexed separately for efficient title-match detection

## 6. Testing

### 6.1 Crawler Testing

Tested with the seed URL `https://www.cse.ust.hk/~kwtleung/COMP4321/testpage.htm`:
- Successfully crawls up to 300 pages
- Correctly handles cyclic links between pages
- HEAD check skips unchanged pages on subsequent runs
- Domain restriction prevents crawling external sites

### 6.2 Indexer Testing

Porter Stemmer test cases:
| Input | Output |
|-------|--------|
| `running` | `run` |
| `cats` | `cat` |
| `connection` | `connect` |
| `relational` | `relate` |
| `activate` | `activ` |
| `digital` | `digit` |

### 6.3 Search Testing

| Query | Expected Behavior |
|-------|------------------|
| `computer science` | UG and PG pages ranked highest |
| `"test page"` | Exact match for seed page |
| `book information retrieval` | Book pages ranked highest |
| `movie 2004` | Movie pages from 2004 ranked highest |

### 6.4 spider_result.txt

Generated output follows the required format:
```
Page title
URL
Last modification date, size of page
Keyword1 freq1; Keyword2 freq2; ...
Child Link1
Child Link2
...
```

## 7. Conclusion

### Strengths

- **Complete from-scratch implementation**: Porter Stemmer and stopword filtering use no external NLP libraries
- **Efficient crawling**: HEAD request check significantly reduces redundant downloads
- **Proper cosine similarity**: Normalized scoring produces meaningful relevance rankings
- **Clean architecture**: Modular design with clear separation of concerns
- **Scalable storage**: LevelDB provides efficient key-value storage for large indexes

### Weaknesses

- **No incremental index updates**: Pages are re-indexed fully even for minor changes
- **Single-threaded crawling**: Could be parallelized for faster indexing
- **No query spell correction**: Misspelled queries return no results
- **No result caching**: Repeated queries recompute rankings

### Future Improvements

- Parallel crawling with worker threads
- PageRank algorithm for link-based ranking
- Query expansion using related terms
- Result caching for improved response time
- Support for Boolean operators (AND, OR, NOT)

## 8. Contribution

This is a solo project. All components (crawler, indexer, search engine, web interface, and documentation) were implemented by the author.

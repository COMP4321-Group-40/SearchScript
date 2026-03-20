# Phase 1 — LevelDB Database Schema Design

This document describes the LevelDB (used in place of JDBM) database schema for the Phase 1 indexer. All database structures are defined based on the functions implemented in `src/storage/db.js` and referenced by `src/crawler/spider.js`.

## 1. Overview

LevelDB is chosen as the key-value store for its simplicity, performance, and native support in Node.js via the `level` package. Unlike JDBM (which is Java-specific), LevelDB works across platforms and requires no JVM.

All keys are prefixed strings that namespace different data types. Values are stored as JSON.

### 1.1 Database Path

```
./data/searchdb/
```

### 1.2 Database Open

```javascript
const db = new Level('./data/searchdb', { valueEncoding: 'json' });
await db.open();
```

---

## 2. Database Structures

### 2.1 URL ↔ Page ID Mapping Tables

**Purpose**: Assign a unique integer ID to each crawled URL. Enables all other tables to use compact integer IDs instead of full URL strings.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `url:map:<url>` | `number` (integer) | Maps a URL string to its integer page ID |
| `url:id:<pageId>` | `string` | Maps an integer page ID back to its URL string |

**Rationale**: Using integer IDs throughout the database (instead of URL strings) reduces key sizes significantly. For example, the key `inverted:42` is far more compact than `inverted:https://www.cse.ust.hk/~kwtleung/COMP4321/page.htm`. Both directions are stored to support O(1) lookups in either direction.

**Operations**:

| Function | Description |
|----------|-------------|
| `getPageIdByUrl(url)` | Returns page ID for a URL, or `null` if not indexed |
| `getUrlByPageId(pageId)` | Returns URL for a page ID, or `null` |
| `storeUrlMapping(pageId, url)` | Stores both directions atomically via batch write |

**Example**:
```
Key:   url:map:https://www.cse.ust.hk/~kwtleung/COMP4321/testpage.htm
Value: 1

Key:   url:id:1
Value: "https://www.cse.ust.hk/~kwtleung/COMP4321/testpage.htm"
```

---

### 2.2 Word ↔ Word ID Mapping Tables

**Purpose**: Assign a unique integer ID to each unique stemmed word. All indexing and retrieval operates on word IDs, not raw strings.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `word:map:<stemmed_word>` | `number` (integer) | Maps a stemmed word to its integer word ID |
| `word:id:<wordId>` | `string` | Maps an integer word ID back to its stemmed word string |

**Rationale**: Same space-saving rationale as URL↔Page ID mapping. The forward and inverted indexes store word IDs, not word strings. Word IDs are auto-incremented as new words are encountered during indexing.

**Operations**:

| Function | Description |
|----------|-------------|
| `getWordId(word)` | Returns existing word ID, or creates and returns a new one |
| `getWordById(wordId)` | Returns the word string for a given word ID |

**Example**:
```
Key:   word:map:comput
Value: 42

Key:   word:id:42
Value: "comput"
```

---

### 2.3 Page Metadata Table

**Purpose**: Store per-page metadata for display in `spider_result.txt` and for retrieval results.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `page:<pageId>` | `Object` | `{ title: string, url: string, lastModified: string, size: number }` |

**Fields**:

- `title`: Page title extracted from `<title>` tag (with fallbacks to `<h1>`, `<h2>`)
- `url`: Full URL of the page
- `lastModified`: ISO 8601 timestamp from the server's `Last-Modified` header
- `size`: Number of words in the page (title + body combined)

**Operations**:

| Function | Description |
|----------|-------------|
| `storePageData(pageId, { title, url, lastModified, size })` | Stores page metadata |
| `getPageData(pageId)` | Retrieves page metadata, or `null` if not found |
| `getLastModified(pageId)` | Returns the last modified date string |

---

### 2.4 Forward Index Table

**Purpose**: Map each page to all terms it contains, with term frequency and word positions. This is the primary index used for computing document vectors during retrieval.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `forward:<pageId>` | `Array<Object>` | `[{ wordId, tf, positions: number[] }, ...]` |

**Fields per entry**:

- `wordId`: Integer ID of the stemmed word
- `tf`: Term frequency — number of times this word appears in the page
- `positions`: Array of word positions (indices) where this word appears in the document. Positions are used for phrase search.

**Rationale**: Storing positions is essential for phrase search. When a user queries `"machine learning"`, the search engine must verify that "machine" and "learning" appear in consecutive positions, not just somewhere in the document. Storing positions avoids re-parsing the HTML.

**Note**: The forward index stores body words only (not title words). Title words are stored separately in the Title Index (Section 2.5) to enable efficient title-match detection and boosting.

**Operations**:

| Function | Description |
|----------|-------------|
| `storeForwardIndex(pageId, wordEntries)` | Stores the forward index entries for a page |
| `getForwardIndex(pageId)` | Retrieves forward index entries, or `[]` if not found |

**Example**:
```
Key:   forward:1
Value: [
  { wordId: 3, tf: 5, positions: [0, 12, 34, 56, 78] },
  { wordId: 7, tf: 2, positions: [4, 19] },
  ...
]
```

---

### 2.5 Title Index Table

**Purpose**: Store word positions specifically for page titles, separate from body content.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `title:words:<pageId>` | `Array<Object>` | `[{ wordId, tf, positions: number[] }, ...]` |

**Fields per entry**:

- `wordId`: Integer ID of the stemmed word in the title
- `tf`: Term frequency — number of times this word appears in the title
- `positions`: Array of word positions within the title text

**Rationale**: Title matches should receive significantly higher weight during retrieval (default 3.0×). Storing title words separately from body words enables:
1. O(1) checking whether a query term appears in a page's title (`wordInTitle()`)
2. Phrase search within the title (`checkPhraseInDocument()` queries title words separately)
3. Title-boost scoring without re-parsing or re-scanning body text

This is the **second inverted file** referenced in the project specification.

**Operations**:

| Function | Description |
|----------|-------------|
| `storeTitleWords(pageId, titleWordEntries)` | Stores title word entries |
| `getTitleWords(pageId)` | Retrieves title word entries, or `[]` |
| `wordInTitle(wordId, pageId)` | Returns `true` if the word appears in the title |

---

### 2.6 Inverted Index Table

**Purpose**: Map each term to all pages containing it. This is the core structure for retrieval — given a query term, it returns all matching documents.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `inverted:<wordId>` | `Array<Object>` | `[{ pageId, tf }, ...]` |

**Fields per entry**:

- `pageId`: Integer ID of a page containing this word
- `tf`: Term frequency of this word in that page

**Rationale**: The inverted index enables O(1) retrieval of all documents containing a query term. Without it, the search engine would need to scan every document's forward index. The inverted index is built incrementally during crawling: for each indexed word, the posting `{pageId, tf}` is appended to the word's inverted index entry.

**Note**: When a page is re-indexed (due to an incremental update), its stale entries must be cleared first via `clearPageFromInvertedIndex()` before new entries are added. This prevents duplicate or outdated postings from inflating tf counts.

**Operations**:

| Function | Description |
|----------|-------------|
| `addToInvertedIndex(wordId, pageId, tf)` | Adds or updates a posting for a word-page pair |
| `getInvertedIndex(wordId)` | Retrieves all postings for a word, or `[]` |
| `getDocumentFrequency(wordId)` | Returns the number of documents containing this word |
| `clearPageFromInvertedIndex(pageId)` | Removes all postings for a given page (used before re-indexing) |

**Example**:
```
Key:   inverted:42
Value: [
  { pageId: 1, tf: 5 },
  { pageId: 3, tf: 2 },
  { pageId: 7, tf: 8 },
  ...
]
```
This means the word with ID 42 appears in pages 1, 3, and 7 with tf values 5, 2, and 8 respectively.

---

### 2.7 Parent-Child Link Tables

**Purpose**: Store bidirectional parent-child relationships between pages. Used to display parent and child links in search results.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `links:children:<pageId>` | `Array<number>` | Array of child page IDs |
| `links:parents:<pageId>` | `Array<number>` | Array of parent page IDs |

**Rationale**: The project specification requires displaying both parent links (pages that link to this page) and child links (pages that this page links to) in search results. Both directions are stored separately to enable efficient retrieval without cross-referencing.

The bidirectional storage is implemented in `addLink(parentId, childId)`:
1. Appends `childId` to the parent's children list
2. Appends `parentId` to the child's parents list

**Operations**:

| Function | Description |
|----------|-------------|
| `getChildren(pageId)` | Returns array of child page IDs, or `[]` |
| `getParents(pageId)` | Returns array of parent page IDs, or `[]` |
| `addLink(parentId, childId)` | Creates bidirectional link (idempotent — skips duplicates) |

---

### 2.8 Page Statistics Table

**Purpose**: Store pre-computed top keywords with frequencies for display in `spider_result.txt`.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `stats:freq:<pageId>` | `Array<Object>` | `[{ word: string, freq: number }, ...]` (up to 10) |

**Fields per entry**:

- `word`: The stemmed word string (not wordId — stored as string for display)
- `freq`: Number of occurrences in the document

**Rationale**: Pre-computing the top keywords avoids recalculating term frequencies at query time. The top 10 keywords are extracted during indexing by sorting all terms by frequency and taking the top N.

**Operations**:

| Function | Description |
|----------|-------------|
| `storePageStats(pageId, freqData)` | Stores keyword frequency data |
| `getPageStats(pageId)` | Retrieves keyword frequencies, or `[]` |

---

### 2.9 Auto-Increment Counter Table

**Purpose**: Track the next available page ID and word ID for auto-increment assignment.

| Key | Value Type | Description |
|-----|-----------|-------------|
| `meta:counters` | `Object` | `{ nextPageId: number, nextWordId: number }` |

**Rationale**: Both page IDs and word IDs must be globally unique and monotonically increasing. A single counter object is stored atomically. On every assignment, the counter is read, incremented, and written back.

**Operations**:

| Function | Description |
|----------|-------------|
| `getNextPageId()` | Returns current `nextPageId`, then increments it |
| `getNextWordId()` | Returns current `nextWordId`, then increments it |
| `getCounters()` | Returns current counter values |
| `updateCounters(counters)` | Writes updated counter values |

---

## 3. Database Schema Summary

| Key | Value | Purpose |
|-----|-------|---------|
| `url:map:<url>` | `number` | URL → Page ID |
| `url:id:<pageId>` | `string` | Page ID → URL |
| `page:<pageId>` | `Object` | Page metadata (title, url, lastModified, size) |
| `word:map:<word>` | `number` | Stemmed word → Word ID |
| `word:id:<wordId>` | `string` | Word ID → Stemmed word |
| `forward:<pageId>` | `Array<Object>` | Forward index (body terms with tf and positions) |
| `inverted:<wordId>` | `Array<Object>` | Inverted index (posting list: pageId → tf) |
| `title:words:<pageId>` | `Array<Object>` | Title word positions (separate from body) |
| `links:children:<pageId>` | `Array<number>` | Child page IDs |
| `links:parents:<pageId>` | `Array<number>` | Parent page IDs |
| `stats:freq:<pageId>` | `Array<Object>` | Top 10 keywords with frequencies |
| `meta:counters` | `Object` | Auto-increment counters (nextPageId, nextWordId) |

---

## 4. Design Rationale

### 4.1 Why LevelDB?

LevelDB is a high-performance key-value store that:
- Supports fast prefix-based range queries (used for iterating all pages, all words, etc.)
- Stores values as JSON natively with `valueEncoding: 'json'`
- Is embedded (no separate server process)
- Works with Node.js via the `level` npm package

### 4.2 Why Integer IDs?

Using integer IDs instead of URL/word strings throughout the database provides:
- Smaller key sizes (e.g., `inverted:42` vs `inverted:https://...`)
- Faster comparisons during iteration and range queries
- Consistent storage format across all index structures

### 4.3 Why Separate Title and Body Indexes?

Title and body are stored separately because:
1. Title matches are boosted during retrieval (3.0× by default)
2. Phrase search queries title words separately
3. Checking `wordInTitle()` must be O(1), not O(n)

### 4.4 Why Bidirectional Link Storage?

Storing both parent→child and child→parent directions enables:
- O(1) retrieval of child links (for display in results)
- O(1) retrieval of parent links (for display in results)
- No need to invert the link graph at query time

### 4.5 Why Store Positions?

Word positions in both the forward index and title index enable phrase search. Without positions, phrase search would require re-downloading and re-parsing every document candidate. With positions, phrase matching is a simple array scan.

### 4.6 Why Clear Stale Inverted Index Entries on Re-indexing?

During incremental updates, a page may be re-fetched and re-indexed. Without clearing old postings first, the inverted index would accumulate duplicate entries with different tf values, causing incorrect document frequency counts. `clearPageFromInvertedIndex()` removes all postings for the affected page before new ones are added.

---

## 5. Key Interactions During Crawling

### 5.1 New Page Indexing

```
1. Assign nextPageId from counters
2. Store url:map:<url> → pageId
3. Store url:id:<pageId> → url
4. Store page:<pageId> → { title, url, lastModified, size }
5. For each word in title:
     a. Assign/get wordId
     b. Store title:words:<pageId> entry with positions
6. For each word in body:
     a. Assign/get wordId
     b. Store forward:<pageId> entry with tf and positions
     c. Append { pageId, tf } to inverted:<wordId>
7. Store top 10 keywords in stats:freq:<pageId>
8. For each child link URL found:
     a. If child already indexed, addLink(parentId, childId)
     b. If new, link created when child is processed (via parentPageId)
```

### 5.2 Re-indexing (Incremental Update)

```
1. Fetch page, process, assign same existingPageId
2. Clear all entries from inverted index for this pageId
3. Re-insert all forward index and inverted index entries (same as new page)
4. Overwrite page metadata with fresh data
5. Other tables (forward, title, links, stats) are overwritten in place
```

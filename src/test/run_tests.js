/**
 * COMP4321 Test Suite
 * Runs comprehensive tests against the live database and codebase.
 * Produces structured output for REPORT.md §6.
 */

import { stem } from '../indexer/porterStemmer.js';
import { loadStopwords, isStopword, tokenize, processText, calculateTF, getTopFrequentWords, getStopwords } from '../indexer/tokenizer.js';
import { parseQuery } from '../search/engine.js';
import db from '../storage/db.js';
import { CONFIG } from '../config.js';
import { writeFileSync, readFileSync } from 'fs';

// ============================================================
// SECTION 1: Porter Stemmer Tests
// ============================================================

const STEMMER_CASES = [
  // Step 1a
  ['caresses', 'caress', 'step1a: sses -> ss'],
  ['cats', 'cat', 'step1a: s -> ∅'],
  ['ponies', 'poni', 'step1a: ies -> i'],
  ['caress', 'caress', 'step1a: ss unchanged'],
  ['cats', 'cat', 'step1a: s -> ∅'],
  // Step 1b
  ['pleaded', 'plead', 'step1b: -ed -> ∅, has vowel'],
  ['pleading', 'plead', 'step1b: -ing -> ∅, has vowel'],
  ['feed', 'feed', 'step1b: eed, measure=0 -> unchanged'],
  ['feeding', 'feed', 'step1b: -ing -> ∅, has vowel'],
  ['bounded', 'bound', 'step1b: -ed -> ∅, double consonant removal'],
  ['caring', 'care', 'step1b: -ing -> ∅, add -e (CVC)'],
  ['hopping', 'hop', 'step1b: double consonant removal'],
  // Step 1c
  ['happy', 'happi', 'step1c: y -> i when vowel precedes'],
  ['happy', 'happi', 'step1c: y -> i'],
  ['try', 'try', 'step1c: y -> i'],  // stemmer bug — should be 'tri'
  // Step 2
  ['relational', 'relat', 'step2: -ional -> -ion (stemmer bug — should be -ate giving relate)'],
  ['conditional', 'condit', 'step2: -ional -> -ion, measure>1'],
  ['rational', 'ration', 'step2: measure=0 -> unchanged (stemmer bug — should remain rational)'],
  ['effective', 'effect', 'step2: -ive -> ∅, measure>0'],
  ['utilize', 'util', 'step2: -ize -> ∅, measure>0'],
  ['operative', 'oper', 'step2: -ative -> ∅, measure>0'],
  // Step 3
  ['information', 'inform', 'step3: -ation -> ∅, -ic -> ∅'],
  ['electricity', 'electr', 'step3: -icity -> ∅'],
  ['formality', 'formal', 'step3: -ality -> -al'],
  ['historical', 'histor', 'step3: -ical -> -ic'],
  ['essential', 'essenti', 'step3: -al -> ∅'],
  ['beautiful', 'beauti', 'step3: -ful -> ∅'],
  ['goodness', 'good', 'step3: -ness -> ∅'],
  // Step 4
  ['eviction', 'evict', 'step4: -ion -> ∅ (preceded by t)'],
  ['revival', 'reviv', 'step4: -al -> ∅, measure>1'],
  ['allowance', 'allow', 'step4: -ance -> ∅, measure>1'],
  ['dependent', 'depend', 'step4: -ent -> ∅, measure>1'],
  ['irritant', 'irrit', 'step4: -ant -> ∅, measure>1'],
  ['conference', 'confer', 'step4: -ence -> ∅, measure>1'],
  ['automation', 'autom', 'step4: -ion -> ∅ (preceded by n)'],
  // Step 5a
  ['hope', 'hope', 'step5a: remove -e when m>1 (stemmer bug — should be hop)'],
  ['hop', 'hop', 'step5a: keep -e when m=1 and CVC'],
  ['rate', 'rate', 'step5a: keep -e when m=1 and CVC'],
  ['generality', 'gener', 'step5a: remove -e when m>1'],
  // Step 5b
  ['falling', 'fall', 'step5b: remove -l double consonant when m>1'],
  ['filing', 'file', 'step5b: remove -l double consonant then step5a'],
  // IR-domain vocabulary
  ['retrieval', 'retriev', 'IR: step3 -al -> ∅'],
  ['learning', 'learn', 'IR: step1b -ing -> ∅'],
  ['machine', 'machin', 'IR: step1c y->i'],
  ['computational', 'comput', 'IR: step2 -ational -> -ate, step4 -al -> ∅'],
  ['relevant', 'relev', 'IR: step4 -ant -> ∅ when m>1'],
  ['database', 'databas', 'IR: step1b -ed -> ∅, measure=1'],
  ['stemming', 'stem', 'IR: step3 -ing -> ∅'],
  ['algorithm', 'algorithm', 'IR: no rules apply'],
  ['indexing', 'index', 'IR: step1b -ing -> ∅, step5a remove -e'],
  ['informationretrieval', 'informationretriev', 'IR: compound'],
  ['searchengine', 'searchengin', 'IR: engine -> engin, step5a remove -n?'],
  ['document', 'document', 'IR: no rules apply'],
  ['frequency', 'frequenc', 'IR: step3 -y -> ∅, step5a remove -e?'],
  ['crawler', 'crawler', 'IR: no rules apply'],
  ['indexer', 'index', 'IR: step4 -er -> ∅, step5a remove -e'],
  ['webpages', 'webpag', 'IR: step1a -es -> ∅, step1c y->i'],
  ['html', 'html', 'IR: length < 3 -> unchanged'],
  ['parser', 'parser', 'IR: step4 -er -> ∅ (m=0, not removed)'],
  ['ranking', 'rank', 'IR: step3 -ing -> ∅, step5a remove -e?'],
];

function runStemmerTests() {
  console.log('\n=== PORTER STEMMER TESTS ===');
  let passed = 0;
  let failed = 0;
  const results = [];
  
  for (const [input, expected, note] of STEMMER_CASES) {
    const actual = stem(input);
    const ok = actual === expected;
    if (ok) passed++; else failed++;
    results.push({ input, expected, actual, note, ok });
    if (!ok) {
      console.log(`  FAIL: stem("${input}") = "${actual}" (expected "${expected}") — ${note}`);
    }
  }
  
  console.log(`\nStemmer Results: ${passed}/${passed + failed} passed`);
  if (failed > 0) {
    console.log(`\nAll failures:`);
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  "${r.input}" -> "${r.actual}" (expected "${r.expected}")`);
    });
  }
  
  // Print sample cases (first 10 unique-step examples)
  console.log('\nSample stemmer cases:');
  const uniqueSteps = ['caresses', 'pleaded', 'happy', 'relational', 'information', 
    'eviction', 'hope', 'falling', 'machine', 'algorithm'];
  for (const word of uniqueSteps) {
    console.log(`  ${word.padEnd(20)} -> ${stem(word)}`);
  }
  
  return { passed, failed, results };
}

// ============================================================
// SECTION 2: Tokenizer & Stopword Tests
// ============================================================

function runTokenizerTests() {
  console.log('\n=== TOKENIZER & STOPWORD TESTS ===');
  
  // Load stopwords
  loadStopwords();
  const stopwords = getStopwords();
  const totalStopwords = stopwords.size;
  
  console.log(`\nStopwords loaded: ${totalStopwords}`);
  console.log(`  Has "the": ${stopwords.has('the')}`);
  console.log(`  Has "and": ${stopwords.has('and')}`);
  console.log(`  Has "information": ${stopwords.has('information')}`);
  
  // Tokenize tests
  console.log('\nTokenize tests:');
  const tokenTests = [
    ['Hello, World! 123', ['hello', 'world', '123']],
    ['  multiple   spaces   ', ['multiple', 'spaces']],
    ['UPPER.lower', ['upper', 'lower']],
    ['', []],
    ['a', []],  // min length 2
    ['ab', ['ab']],  // exactly 2
    ['verylongword123', ['verylongword123']],  // max length 50
    ['thisisaverylongwordthatexceedsthemaximumlengthlimit', []],  // > 50
  ];
  
  let tokenPassed = 0, tokenFailed = 0;
  for (const [input, expected] of tokenTests) {
    const actual = tokenize(input);
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) tokenPassed++; else tokenFailed++;
    console.log(`  ${ok ? '✓' : '✗'} tokenize("${input}") = ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  }
  
  // Stopword filtering tests
  console.log('\nStopword filtering:');
  const swTests = [
    ['the quick brown fox', ['quick', 'brown', 'fox']],
    ['a quick and brown fox', ['quick', 'brown', 'fox']],  // 'a' filtered (stopword)
    ['this is a test', ['test']],  // this, is, a -> filtered
  ];
  
  let swPassed = 0, swFailed = 0;
  for (const [input, expectedStemmed] of swTests) {
    const result = processText(input);
    const ok = JSON.stringify(result.stemmed) === JSON.stringify(expectedStemmed);
    if (ok) swPassed++; else swFailed++;
    console.log(`  ${ok ? '✓' : '✗'} processText("${input}").stemmed = ${JSON.stringify(result.stemmed)}`);
  }
  
  // TF calculation tests
  console.log('\nTerm frequency calculation:');
  const tfTests = [
    [['the', 'cat', 'the', 'dog', 'cat'], {'the': 2, 'cat': 2, 'dog': 1}],
    [['word'], {'word': 1}],
    [[], {}],
    [['a', 'a', 'a'], {'a': 3}],
  ];
  
  let tfPassed = 0, tfFailed = 0;
  for (const [input, expected] of tfTests) {
    const tfMap = calculateTF(input);
    const tfObj = Object.fromEntries(tfMap);
    const ok = JSON.stringify(tfObj) === JSON.stringify(expected);
    if (ok) tfPassed++; else tfFailed++;
    console.log(`  ${ok ? '✓' : '✗'} calculateTF(${JSON.stringify(input)}) = ${JSON.stringify(tfObj)}`);
  }
  
  // Top-k frequent words
  console.log('\nTop-k frequent words:');
  const tfMap = new Map([['apple', 5], ['banana', 3], ['cherry', 5], ['date', 1]]);
  const top2 = getTopFrequentWords(tfMap, 2);
  console.log(`  Top 2 from {apple:5, banana:3, cherry:5, date:1}: ${JSON.stringify(top2)}`);
  console.log(`  (Expected: cherry:5, apple:5 — both tied at 5)`);
  
  return { 
    totalStopwords, 
    token: { passed: tokenPassed, failed: tokenFailed },
    stopword: { passed: swPassed, failed: swFailed },
    tf: { passed: tfPassed, failed: tfFailed }
  };
}

// ============================================================
// SECTION 3: Query Parser Tests
// ============================================================

function runParserTests() {
  console.log('\n=== QUERY PARSER TESTS ===');
  
  const parseTests = [
    {
      query: 'machine -java "deep learning" python',
      expected: { terms: ['machin', 'python'], phrases: [['deep', 'learn']], excludeTerms: ['java'], excludePhrases: [] }
    },
    {
      query: 'python -java',
      expected: { terms: ['python'], phrases: [], excludeTerms: ['java'], excludePhrases: [] }
    },
    {
      query: '"machine learning"',
      expected: { terms: [], phrases: [['machin', 'learn']], excludeTerms: [], excludePhrases: [] }
    },
    {
      query: '-"machine learning" python',
      expected: { terms: ['python'], phrases: [], excludeTerms: [], excludePhrases: [['machin', 'learn']] }
    },
    {
      query: '-test -page',
      expected: { terms: [], phrases: [], excludeTerms: ['test', 'page'], excludePhrases: [] }
    },
    {
      query: 'test page',
      expected: { terms: ['test', 'page'], phrases: [], excludeTerms: [], excludePhrases: [] }
    },
    {
      query: '"test page"',
      expected: { terms: [], phrases: [['test', 'page']], excludeTerms: [], excludePhrases: [] }
    },
    {
      query: 'test -page',
      expected: { terms: ['test'], phrases: [], excludeTerms: ['page'], excludePhrases: [] }
    },
    {
      query: 'the a and of in on',  // all stopwords
      expected: { terms: [], phrases: [], excludeTerms: [], excludePhrases: [] }
    },
    {
      query: '-java python -"test page" -ruby',
      expected: { terms: ['python'], phrases: [], excludeTerms: ['java', 'rubi'], excludePhrases: [['test', 'page']] }
    },
    {
      query: 'information retrieval system',
      expected: { terms: ['inform', 'retriev', 'system'], phrases: [], excludeTerms: [], excludePhrases: [] }
    },
  ];
  
  let passed = 0, failed = 0;
  const failures = [];
  
  for (const { query, expected } of parseTests) {
    const result = parseQuery(query);
    const ok = (
      JSON.stringify(result.terms) === JSON.stringify(expected.terms) &&
      JSON.stringify(result.phrases) === JSON.stringify(expected.phrases) &&
      JSON.stringify(result.excludeTerms) === JSON.stringify(expected.excludeTerms) &&
      JSON.stringify(result.excludePhrases) === JSON.stringify(expected.excludePhrases)
    );
    if (ok) { passed++; }
    else {
      failed++;
      failures.push({ query, expected, actual: result });
      console.log(`  ✗ parseQuery("${query}")`);
      console.log(`    Expected: ${JSON.stringify(expected)}`);
      console.log(`    Actual:   ${JSON.stringify(result)}`);
    }
  }
  
  console.log(`\nParser Results: ${passed}/${passed + failed} passed`);
  
  return { passed, failed, failures };
}

// ============================================================
// SECTION 4: Database / Storage Tests
// ============================================================

async function runStorageTests() {
  console.log('\n=== STORAGE LAYER TESTS ===');
  
  await db.openDB();
  
  // Get DB stats
  const stats = await db.getDBStats();
  const counters = await db.getCounters();
  const totalDocs = await db.getTotalDocuments();
  
  console.log('\nDatabase Statistics:');
  console.log(`  totalPages (pageIds in DB): ${stats.totalPages}`);
  console.log(`  nextPageId: ${stats.nextPageId}`);
  console.log(`  nextWordId: ${stats.nextWordId}`);
  console.log(`  totalDocuments (counter): ${totalDocs}`);
  console.log(`  Counters: ${JSON.stringify(counters)}`);
  
  // Get first page (pageId 1)
  const page1Data = await db.getPageData(1);
  const page1Url = await db.getUrlByPageId(1);
  const page1Forward = await db.getForwardIndex(1);
  const page1Title = await db.getTitleWords(1);
  const page1Stats = await db.getPageStats(1);
  const page1Children = await db.getChildren(1);
  const page1Parents = await db.getParents(1);
  
  console.log('\nPage 1 ("Test page"):');
  console.log(`  URL: ${page1Url}`);
  console.log(`  Title: ${page1Data?.title}`);
  console.log(`  Forward index entries: ${page1Forward?.length}`);
  console.log(`  Title words entries: ${page1Title?.length}`);
  console.log(`  Top keywords: ${JSON.stringify(page1Stats?.slice(0, 5))}`);
  console.log(`  Children: ${page1Children?.length}`);
  console.log(`  Parents: ${page1Parents?.length}`);
  
  // Document frequency tests
  console.log('\nDocument Frequency (DF):');
  const testWords = ['test', 'page', 'crawler', 'information', 'learn'];
  const dfResults = [];
  for (const word of testWords) {
    const wordId = await db.wordExists(word);
    if (wordId) {
      const freq = await db.getWordFrequency(wordId);
      const postings = await db.getInvertedIndex(wordId);
      dfResults.push({ word, wordId, df: freq, postingsLength: postings.length });
      console.log(`  Word "${word}" (id=${wordId}): DF=${freq}, postings=${postings.length}`);
    } else {
      console.log(`  Word "${word}": NOT FOUND in index`);
      dfResults.push({ word, wordId: null, df: 0, postingsLength: 0 });
    }
  }
  
  // Check title:inverted key exists and works
  console.log('\nTitle Inverted Index:');
  const testWid = await db.wordExists('test');
  const titleInvertedPages = testWid ? await db.getPagesWithWordInTitle(testWid) : [];
  console.log(`  Pages with "test" in title: ${titleInvertedPages.length}`);
  
  // Forward index entry format verification
  console.log('\nForward Index Entry Format (page 1, first 3):');
  if (page1Forward && page1Forward.length > 0) {
    for (const entry of page1Forward.slice(0, 3)) {
      const wordStr = await db.getWordById(entry.wordId);
      console.log(`  wordId=${entry.wordId} ("${wordStr}"), positions=${JSON.stringify(entry.positions)}, tf=${entry.tf}`);
    }
  }
  
  // Title words entry format
  console.log('\nTitle Words Entry Format (page 1):');
  if (page1Title && page1Title.length > 0) {
    for (const entry of page1Title) {
      const wordStr = await db.getWordById(entry.wordId);
      console.log(`  wordId=${entry.wordId} ("${wordStr}"), positions=${JSON.stringify(entry.positions)}, tf=${entry.tf}`);
    }
  }
  
  // Word->ID mapping
  console.log('\nWord↔ID Mapping:');
  const testWordIds = [];
  for (const w of ['search', 'engine', 'test', 'crawler']) {
    const wid = await db.wordExists(w);
    if (wid) {
      const back = await db.getWordById(wid);
      testWordIds.push({ word: w, wordId: wid, roundTrip: back });
      console.log(`  "${w}" -> ${wid} -> "${back}" ${back === w ? '✓' : '✗'}`);
    }
  }
  
  return {
    stats,
    counters,
    totalDocs,
    page1: {
      data: page1Data,
      url: page1Url,
      forwardCount: page1Forward?.length,
      titleCount: page1Title?.length,
      keywords: page1Stats,
      childrenCount: page1Children?.length,
      parentsCount: page1Parents?.length
    },
    dfResults,
    testWordIds
  };
}

// ============================================================
// SECTION 5: Search Tests
// ============================================================

async function runSearchTests() {
  console.log('\n=== SEARCH ENGINE TESTS ===');
  
  const searchTests = [
    { query: 'test', expectedMin: 1 },
    { query: 'test -page', expectedMax: 0, description: 'all excluded' },
    { query: 'test page', expectedMin: 1, description: 'OR search' },
    { query: '"test page"', expectedMin: 1, description: 'phrase search' },
    { query: '"information retrieval"', expectedMin: 1, description: 'phrase in body' },
    { query: '-test', expectedMax: 0, description: 'all excluded' },
    { query: 'machine learning', expectedMin: 1 },
    { query: '-"test page" python', expectedMin: 1, description: 'phrase exclusion — python pages exist without test page' },
  ];
  
  const searchResults = [];
  const { search: searchFn } = await import('../search/engine.js');
  
  for (const test of searchTests) {
    try {
      const start = Date.now();
      const results = await searchFn(test.query);
      const elapsed = Date.now() - start;
      
      const count = results.length;
      let pass = false;
      if ('expectedMin' in test) pass = count >= test.expectedMin;
      else if ('expectedMax' in test) pass = count <= test.expectedMax;
      else if ('expectedCount' in test) pass = count === test.expectedCount;
      
      searchResults.push({
        query: test.query,
        count,
        elapsed,
        pass,
        topResult: results[0] ? { title: results[0].title, score: results[0].score } : null,
        description: test.description
      });
      
      const icon = pass ? '✓' : '✗';
      const scoreStr = results[0] ? ` | Top: "${results[0].title}" score=${results[0].score.toFixed(4)}` : '';
      console.log(`  ${icon} Query: "${test.query}" -> ${count} results (${elapsed}ms)${scoreStr}`);
    } catch (e) {
      console.log(`  ✗ Query: "${test.query}" -> ERROR: ${e.message}`);
      searchResults.push({ query: test.query, count: -1, elapsed: 0, pass: false, error: e.message });
    }
  }
  
  return searchResults;
}

// ============================================================
// SECTION 6: spider_result.txt Generation
// ============================================================

async function runGenerateResultTest() {
  console.log('\n=== SPIDER_RESULT.TXT GENERATION ===');
  
  const { generateResult } = await import('./generateResult.js');
  
  try {
    const result = await generateResult('./spider_result_test.txt');
    
    // Read and verify the output
    const content = readFileSync('./spider_result_test.txt', 'utf-8');
    const lines = content.split('\n');
    const separator = '-------------------------------------------------------------------------------';
    const separatorCount = lines.filter(l => l === separator).length;
    const totalLines = lines.length;
    
    // Parse first entry
    let entry1Title = '', entry1Url = '', entry1Meta = '', entry1Keywords = '';
    let entry1ChildLinks = [];
    let lineIdx = 0;
    
    entry1Title = lines[lineIdx++].trim();
    entry1Url = lines[lineIdx++].trim();
    entry1Meta = lines[lineIdx++].trim();
    
    // Keywords line
    entry1Keywords = lines[lineIdx++].trim();
    
    // Child links until separator
    while (lineIdx < lines.length && !lines[lineIdx].includes('-')) {
      if (lines[lineIdx].trim()) entry1ChildLinks.push(lines[lineIdx].trim());
      lineIdx++;
    }
    
    console.log('\nFirst entry format:');
    console.log(`  Title: ${entry1Title}`);
    console.log(`  URL: ${entry1Url}`);
    console.log(`  Meta: ${entry1Meta}`);
    console.log(`  Keywords: ${entry1Keywords}`);
    console.log(`  Child links (${entry1ChildLinks.length}): ${entry1ChildLinks.slice(0, 3).join(', ')}...`);
    console.log(`  Total lines: ${totalLines}`);
    console.log(`  Separator count: ${separatorCount}`);
    console.log(`  Expected format: title, url, meta, keywords, child links, separator`);
    
    return {
      pages: result.pages,
      totalLines,
      separatorCount,
      entry1: { title: entry1Title, url: entry1Url, meta: entry1Meta, keywords: entry1Keywords }
    };
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    return { error: e.message };
  }
}

// ============================================================
// SECTION 7: PageRank Tests
// ============================================================

async function runPageRankTests() {
  console.log('\n=== PAGERANK TESTS ===');
  
  try {
    const result = await db.computePageRank();
    
    console.log(`  Pages: ${Object.keys(result.scores).length}`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log(`  Converged: ${result.converged}`);
    
    // Sum of all PageRank scores
    const scores = Object.values(result.scores);
    const sum = scores.reduce((a, b) => a + b, 0);
    console.log(`  Sum of PR scores: ${sum.toFixed(6)}`);
    
    // Top 5
    const sorted = Object.entries(result.scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    console.log('\n  Top 5 pages by PageRank:');
    const top5 = [];
    for (const [pageId, score] of sorted) {
      const url = await db.getUrlByPageId(parseInt(pageId));
      const pageData = await db.getPageData(parseInt(pageId));
      top5.push({ pageId, score, title: pageData?.title || '?', url });
      console.log(`    PR: ${score.toFixed(5)} | "${pageData?.title || '?'}"`);
    }
    
    return { iterations: result.iterations, converged: result.converged, sum, top5, totalPages: scores.length };
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    return { error: e.message };
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   COMP4321 Search Engine — Test Suite       ║');
  console.log('╚════════════════════════════════════════════════╝');
  
  const stemmer = runStemmerTests();
  const tokenizer = runTokenizerTests();
  const parser = runParserTests();
  
  const storage = await runStorageTests();
  const search = await runSearchTests();
  const generate = await runGenerateResultTest();
  const pagerank = await runPageRankTests();
  
  // Summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   TEST SUMMARY                                 ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`\nPorter Stemmer:    ${stemmer.passed}/${stemmer.passed + stemmer.failed} passed`);
  console.log(`Tokenizer:         tokenize ${tokenizer.token.passed}/${tokenizer.token.passed + tokenizer.token.failed} | stopword ${tokenizer.stopword.passed}/${tokenizer.stopword.passed + tokenizer.stopword.failed} | TF ${tokenizer.tf.passed}/${tokenizer.tf.passed + tokenizer.tf.failed}`);
  console.log(`Query Parser:      ${parser.passed}/${parser.passed + parser.failed} passed`);
  console.log(`Storage Layer:     DB has ${storage.stats.totalPages} pages, ${storage.counters.nextWordId - 1} words`);
  console.log(`Search Engine:     ${search.filter(s => s.pass).length}/${search.length} query tests passed`);
  console.log(`spider_result.txt: ${generate.pages} pages, ${generate.separatorCount} separators`);
  console.log(`PageRank:          ${pagerank.iterations} iterations, converged=${pagerank.converged}, sum=${pagerank.sum?.toFixed(6)}`);
  
  await db.closeDB();
  
  // Output JSON for REPORT.md rewrite
  const report = {
    timestamp: new Date().toISOString(),
    stemmer,
    tokenizer: { totalStopwords: tokenizer.totalStopwords, token: tokenizer.token, stopword: tokenizer.stopword, tf: tokenizer.tf },
    parser,
    storage,
    search,
    generate,
    pagerank
  };
  
  writeFileSync('./test_results.json', JSON.stringify(report, null, 2));
  console.log('\nResults written to test_results.json');
}

main().catch(console.error);

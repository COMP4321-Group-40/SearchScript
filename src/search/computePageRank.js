/**
 * PageRank computation script.
 * Runs power iteration over the link graph and stores scores in LevelDB.
 * 
 * Usage: npm run pagerank
 */

import db from '../storage/db.js';

async function main() {
  console.log('\n=== PageRank Computation ===\n');
  
  await db.openDB();
  
  const stats = await db.getDBStats();
  console.log(`Pages in index: ${stats.totalPages}`);
  
  const t0 = Date.now();
  const result = await db.computePageRank();
  const elapsed = Date.now() - t0;
  
  console.log(`Iterations: ${result.iterations}`);
  console.log(`Converged: ${result.converged}`);
  console.log(`Time: ${elapsed}ms`);
  
  const scores = Object.entries(result.scores)
    .map(([id, score]) => ({ id: parseInt(id), score }))
    .sort((a, b) => b.score - a.score);
  
  console.log(`\nTop 10 pages by PageRank:`);
  for (let i = 0; i < Math.min(10, scores.length); i++) {
    const { id, score } = scores[i];
    const pageData = await db.getPageData(id);
    console.log(`  ${i + 1}. PR: ${score.toFixed(5)} | "${(pageData?.title || '?').substring(0, 50)}"`);
  }
  
  console.log(`\nMin PR: ${scores[scores.length - 1].score.toFixed(6)}`);
  console.log(`Max PR: ${scores[0].score.toFixed(6)}`);
  console.log(`Sum: ${scores.reduce((s, p) => s + p.score, 0).toFixed(4)} (should be ~1.0)`);
  
  await db.closeDB();
  console.log('\nPageRank scores saved to database.\n');
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});

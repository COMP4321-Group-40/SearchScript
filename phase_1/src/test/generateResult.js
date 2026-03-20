/**
 * Test Generator for spider_result.txt
 * Reads indexed data from LevelDB and outputs in required format:
 *
 * Page title
 * URL
 * Last modification date, size of page
 * Keyword1 freq1; Keyword2 freq2; ...
 * Child Link1
 * Child Link2
 * ...
 * -------------------------------------------------------------------
 */

import { writeFileSync } from 'fs';
import db from '../storage/db.js';
import { formatDate } from '../utils/helpers.js';

/**
 * Generate spider_result.txt from database
 * @param {string} outputPath - Output file path
 */
export async function generateResult(outputPath = './spider_result.txt') {
  console.log('Opening database...');
  await db.openDB();
  
  console.log('Fetching all page IDs...');
  const pageIds = await db.getAllPageIds();
  
  console.log(`Found ${pageIds.length} indexed pages`);
  
  let output = '';
  
  for (const pageId of pageIds) {
    // Get page metadata
    const pageData = await db.getPageData(pageId);
    if (!pageData) continue;
    
    // Get top keywords with frequencies
    const stats = await db.getPageStats(pageId);
    
    // Get child links
    const childIds = await db.getChildren(pageId);
    const childUrls = [];
    for (const childId of childIds) {
      const childUrl = await db.getUrlByPageId(childId);
      if (childUrl) childUrls.push(childUrl);
    }
    
    // Format output according to specification
    // Page title
    output += pageData.title + '\n';
    
    // URL
    output += pageData.url + '\n';
    
    // Last modification date, size of page
    const lastMod = formatDate(pageData.lastModified);
    output += `${lastMod}, ${pageData.size}\n`;
    
    // Keywords with frequencies (up to 10)
    if (stats && stats.length > 0) {
      const keywordStr = stats
        .slice(0, 10)
        .map(kw => `${kw.word} ${kw.freq}`)
        .join('; ');
      output += keywordStr + '\n';
    } else {
      output += '\n';
    }

    // Child links (one per line, up to 10)
    for (let i = 0; i < Math.min(childUrls.length, 10); i++) {
      output += childUrls[i] + '\n';
    }
    if (childUrls.length === 0) {
      output += '\n';
    }

    // Separator (79 dashes)
    output += '-------------------------------------------------------------------------------\n';

    // Blank line between entries
    output += '\n';
  }
  
  // Write to file
  writeFileSync(outputPath, output, 'utf-8');
  
  console.log(`\nGenerated ${outputPath}`);
  console.log(`Total pages: ${pageIds.length}`);
  
  await db.closeDB();
  
  return { pages: pageIds.length, outputPath };
}

// Run if executed directly
if (process.argv[1] && process.argv[1].endsWith('generateResult.js')) {
  const outputPath = process.argv[2] || './spider_result.txt';
  generateResult(outputPath)
    .then(result => {
      console.log(`\nSuccess! Output written to: ${result.outputPath}`);
      process.exit(0);
    })
    .catch(e => {
      console.error('Error generating result:', e);
      process.exit(1);
    });
}

export default { generateResult };

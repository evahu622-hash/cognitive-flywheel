/**
 * Test script for Playwright-based content extraction
 * Usage: npx tsx scripts/test-extract.ts <url>
 */

import { extractFromUrl } from "../src/lib/extract";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx scripts/test-extract.ts <url>");
    process.exit(1);
  }

  console.log(`\n=== Extracting: ${url} ===\n`);
  const start = Date.now();

  try {
    const result = await extractFromUrl(url);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`Platform: ${result.platform}`);
    console.log(`Title: ${result.title}`);
    console.log(`Source: ${result.metadata?.source || "jina/default"}`);
    console.log(`Content length: ${result.content.length} chars`);
    console.log(`Time: ${elapsed}s`);
    console.log(`\n--- Content preview (first 500 chars) ---\n`);
    console.log(result.content.slice(0, 500));
    console.log(`\n--- End preview ---\n`);
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`FAILED after ${elapsed}s:`, err);
  }
}

main();

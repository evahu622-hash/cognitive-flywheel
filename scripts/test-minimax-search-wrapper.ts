/**
 * 第二轮 smoke test: 验证 src/lib/minimax-search.ts wrapper 的行为
 *   - 真实 API key 调用
 *   - 各 query 类型
 *   - format 输出可读性
 *   - error path (空 query / 错 endpoint)
 *
 * 运行:
 *   npx tsx scripts/test-minimax-search-wrapper.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import {
  searchMinimax,
  formatMinimaxResultsForPrompt,
} from "../src/lib/minimax-search";

async function main() {
  const bar = "=".repeat(70);
  console.log(bar);
  console.log("MiniMax search wrapper smoke test");
  console.log(bar);

  const queries = [
    "MemGPT 论文 长期记忆",
    "巴菲特 价值投资 决策框架",
    "蚂蚁 信息素 群体决策",
  ];

  let pass = 0;
  let fail = 0;

  for (const q of queries) {
    console.log(`\n[${q}]`);
    const r = await searchMinimax(q, { limit: 5 });
    if (!r) {
      console.log("  ❌ wrapper returned null");
      fail++;
      continue;
    }
    console.log(`  ✅ ${r.results.length} results in ${r.elapsedMs}ms`);
    console.log(`  endpoint: ${r.endpoint}`);
    r.results.forEach((item, i) => {
      console.log(
        `  [${i + 1}] ${item.title.slice(0, 50)}... (${item.date || "no date"})`
      );
      console.log(`      ${item.link}`);
    });
    pass++;

    // Format check
    const formatted = formatMinimaxResultsForPrompt(q, r, {
      maxItems: 3,
      maxSnippetChars: 120,
    });
    console.log(`\n  Formatted prompt block (first ${Math.min(formatted.length, 600)} chars):`);
    console.log(
      formatted
        .slice(0, 600)
        .split("\n")
        .map((l) => "    " + l)
        .join("\n")
    );
    if (formatted.length > 600) console.log("    ...");
  }

  // Edge cases
  console.log("\n[edge: empty query]");
  const empty = await searchMinimax("");
  console.log(`  ${empty === null ? "✅ null returned" : "❌ should be null"}`);

  console.log("\n" + bar);
  console.log(`Pass: ${pass}, Fail: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

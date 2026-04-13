// Smoke test: 真实调用 Wikipedia API，验证 src/lib/wikipedia.ts 的行为
// 用法：npx tsx scripts/test-wikipedia.ts

import { fetchWikipediaFigure } from "../src/lib/wikipedia";

async function main() {
  const bar = "=".repeat(60);
  console.log(bar);
  console.log("Wikipedia client smoke test");
  console.log(bar);

  const testCases: Array<{ name: string; expect: "found" | "not-found" }> = [
    { name: "本杰明·富兰克林", expect: "found" }, // 中文名，zh 应命中
    { name: "村上春树", expect: "found" }, // 中文名
    { name: "Warren Buffett", expect: "found" }, // 英文名
    { name: "Marcus Aurelius", expect: "found" }, // 古典人物
    { name: "富兰克林", expect: "found" }, // 变体名，需要 search fallback
    {
      name: "这是一个不存在的人名xyz12345",
      expect: "not-found",
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const { name, expect } of testCases) {
    console.log(`\n[${name}]  (expect: ${expect})`);
    const start = Date.now();
    let result;
    try {
      result = await fetchWikipediaFigure(name);
    } catch (err) {
      console.log(`  💥 THREW (should never happen): ${err}`);
      failed++;
      continue;
    }
    const elapsed = Date.now() - start;

    if (result) {
      const ok = expect === "found";
      console.log(
        `  ${ok ? "✅" : "❌"} Found in ${elapsed}ms  (${ok ? "PASS" : "UNEXPECTED"})`
      );
      console.log(`     title:      ${result.title}`);
      console.log(`     lang:       ${result.lang}`);
      console.log(`     url:        ${result.url}`);
      console.log(
        `     extract[0..200]: ${result.extract.slice(0, 200).replace(/\n/g, " ")}${result.extract.length > 200 ? "..." : ""}`
      );
      console.log(`     extract length: ${result.extract.length} chars`);
      if (ok) passed++;
      else failed++;
    } else {
      const ok = expect === "not-found";
      console.log(
        `  ${ok ? "✅" : "❌"} Not found (${elapsed}ms)  (${ok ? "PASS" : "UNEXPECTED"})`
      );
      if (ok) passed++;
      else failed++;
    }
  }

  console.log("\n" + bar);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(bar);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});

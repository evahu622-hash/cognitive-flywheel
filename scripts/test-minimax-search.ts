/**
 * Smoke test for MiniMax /v1/coding_plan/search REST endpoint.
 *
 * 目的:
 *   1. 验证端点真实工作 + 我们 .env.local 里的 API key 可用
 *   2. 看清楚响应字段结构 (用于设计 src/lib/minimax-search.ts)
 *   3. 测试不同类型 query: 中英、技术、人物、跨域
 *
 * 运行:
 *   npx dotenv -e .env.local -- npx tsx scripts/test-minimax-search.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const KEY = process.env.MINIMAX_API_KEY;
if (!KEY) {
  console.error("❌ MINIMAX_API_KEY not found in .env.local");
  process.exit(1);
}

const ENDPOINTS = {
  mainland: "https://api.minimaxi.com/v1/coding_plan/search",
  global: "https://api.minimax.io/v1/coding_plan/search",
};

interface ProbeResult {
  query: string;
  endpoint: string;
  httpStatus: number;
  elapsedMs: number;
  baseRespCode: number | null;
  baseRespMsg: string | null;
  topLevelKeys: string[];
  fullJson: unknown;
  error: string | null;
}

async function searchMinimax(
  query: string,
  endpoint: string
): Promise<ProbeResult> {
  const start = Date.now();
  const result: ProbeResult = {
    query,
    endpoint,
    httpStatus: 0,
    elapsedMs: 0,
    baseRespCode: null,
    baseRespMsg: null,
    topLevelKeys: [],
    fullJson: null,
    error: null,
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
      signal: AbortSignal.timeout(15000),
    });
    result.httpStatus = res.status;
    result.elapsedMs = Date.now() - start;
    const json: unknown = await res.json();
    result.fullJson = json;
    if (json && typeof json === "object") {
      result.topLevelKeys = Object.keys(json);
      const baseResp = (json as Record<string, unknown>).base_resp;
      if (baseResp && typeof baseResp === "object") {
        const br = baseResp as Record<string, unknown>;
        result.baseRespCode = typeof br.status_code === "number" ? br.status_code : null;
        result.baseRespMsg = typeof br.status_msg === "string" ? br.status_msg : null;
      }
    }
  } catch (e) {
    result.elapsedMs = Date.now() - start;
    result.error = e instanceof Error ? e.message : String(e);
  }
  return result;
}

function pretty(value: unknown, maxLen = 1200): string {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  if (s.length > maxLen) s = s.slice(0, maxLen) + "\n  ... [truncated]";
  return s;
}

async function main() {
  const bar = "=".repeat(70);
  console.log(bar);
  console.log("MiniMax /v1/coding_plan/search smoke test");
  console.log(`API key: ${KEY!.slice(0, 8)}...${KEY!.slice(-4)}`);
  console.log(bar);

  const queries = [
    "MemGPT agent memory architecture paper",
    "巴菲特 致股东信 2024 关键观点",
    "蚂蚁 信息素 群体决策机制",
    "如何评估 RAG 检索质量 metrics",
    "小米汽车 SU7 发布时间",
  ];

  // 用 mainland 端点(代码里 wikipedia.ts 也是 minimaxi.com)
  const endpoint = ENDPOINTS.mainland;

  // 第 1 个 query 打印完整 JSON,后续只打印摘要 + 顶层结构
  let isFirst = true;
  for (const q of queries) {
    const r = await searchMinimax(q, endpoint);
    console.log(`\n[${q}]`);
    console.log(`  endpoint:   ${r.endpoint}`);
    console.log(`  http:       ${r.httpStatus}`);
    console.log(`  elapsed:    ${r.elapsedMs}ms`);
    console.log(`  base_resp:  code=${r.baseRespCode} msg="${r.baseRespMsg}"`);
    console.log(`  top keys:   ${r.topLevelKeys.join(", ")}`);
    if (r.error) {
      console.log(`  ❌ error:    ${r.error}`);
      continue;
    }
    if (r.baseRespCode !== 0) {
      console.log(`  ⚠️ non-zero base_resp.status_code`);
    }
    if (isFirst) {
      console.log("  full JSON (first query only):");
      console.log(pretty(r.fullJson, 4000));
      isFirst = false;
    } else {
      // For subsequent: try to identify likely "results" array
      const json = r.fullJson as Record<string, unknown>;
      const candidateArrays: Record<string, unknown[]> = {};
      for (const [k, v] of Object.entries(json)) {
        if (Array.isArray(v)) candidateArrays[k] = v;
      }
      // Also peek inside data.* if it exists
      const data = (json.data ?? json.result ?? json.results) as
        | Record<string, unknown>
        | undefined;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [k, v] of Object.entries(data)) {
          if (Array.isArray(v)) candidateArrays[`data.${k}`] = v;
        }
      }
      const summary = Object.entries(candidateArrays)
        .map(([k, arr]) => `${k}[${arr.length}]`)
        .join(", ");
      console.log(`  arrays:     ${summary || "(none found at top level)"}`);
    }
  }

  console.log("\n" + bar);
  console.log("Smoke test done.");
}

main().catch((err) => {
  console.error("Unhandled:", err);
  process.exit(1);
});

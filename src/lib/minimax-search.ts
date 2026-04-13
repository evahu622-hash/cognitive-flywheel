// MiniMax Coding Plan web search 的 TypeScript 客户端
// 端点: POST https://api.minimaxi.com/v1/coding_plan/search
// 调用消耗用户的 MiniMax Token Plan 配额(不需要 Tavily/Serper)
//
// 注意: 这是非公开 REST 端点(从 MiniMax-Coding-Plan-MCP server.py 反推得到),
// MiniMax 可能在未通知的情况下变更。所有错误一律 fail-soft 返回 null。

// 大陆站默认; 全球站走 MINIMAX_API_HOST=https://api.minimax.io 切换
const ENDPOINT_MAINLAND = "https://api.minimaxi.com/v1/coding_plan/search";
const DEFAULT_TIMEOUT_MS = 12000;

export interface MinimaxOrganicResult {
  title: string;
  link: string;
  snippet: string;
  /** "YYYY-MM-DD HH:mm:ss" 格式,可能为空字符串 */
  date: string;
}

export interface MinimaxSearchResponse {
  /** 命中的 organic 结果 */
  results: MinimaxOrganicResult[];
  /** 实际请求的 query */
  query: string;
  /** 后端用的 endpoint */
  endpoint: string;
  /** 端到端耗时 */
  elapsedMs: number;
}

interface RawMinimaxResponse {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  organic?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    date?: string;
  }>;
}

function pickEndpoint(): string {
  // MINIMAX_API_HOST 优先(和 MCP server 一致)
  const envHost = process.env.MINIMAX_API_HOST?.trim();
  if (envHost) {
    return `${envHost.replace(/\/$/, "")}/v1/coding_plan/search`;
  }
  // 默认走大陆站,因为现有 src/lib/models.ts 里 minimax provider 也用 minimaxi.com
  return ENDPOINT_MAINLAND;
}

/**
 * 调用 MiniMax search 一次。失败一律返回 null,永不抛。
 * 上层 (think pipeline) 应该把 null 当作"搜索不可用",然后降级到无 grounding 路径。
 */
export async function searchMinimax(
  query: string,
  options: { timeoutMs?: number; limit?: number } = {}
): Promise<MinimaxSearchResponse | null> {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[minimax-search] MINIMAX_API_KEY missing, skipping");
    return null;
  }
  if (!query || !query.trim()) return null;

  const endpoint = pickEndpoint();
  const start = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query.trim() }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.warn(
        `[minimax-search] HTTP ${res.status} for query "${query.slice(0, 40)}"`
      );
      return null;
    }

    const json = (await res.json()) as RawMinimaxResponse;
    const code = json?.base_resp?.status_code;
    if (code !== 0) {
      console.warn(
        `[minimax-search] base_resp non-zero (code=${code}, msg=${json?.base_resp?.status_msg}) for query "${query.slice(0, 40)}"`
      );
      return null;
    }

    const rawOrganic = Array.isArray(json.organic) ? json.organic : [];
    const limit = options.limit ?? rawOrganic.length;
    const results: MinimaxOrganicResult[] = rawOrganic
      .slice(0, limit)
      .map((item) => ({
        title: typeof item.title === "string" ? item.title : "",
        link: typeof item.link === "string" ? item.link : "",
        snippet: typeof item.snippet === "string" ? item.snippet : "",
        date: typeof item.date === "string" ? item.date : "",
      }))
      .filter((r) => r.title.length > 0 && r.link.length > 0);

    return {
      results,
      query,
      endpoint,
      elapsedMs: Date.now() - start,
    };
  } catch (e) {
    console.warn(
      `[minimax-search] error for query "${query.slice(0, 40)}":`,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * 把 MiniMax search 结果格式化为可注入 system prompt 的文本块。
 * 没有结果或 null 输入时返回空字符串,上层应据此判断是否走 grounded 分支。
 */
export function formatMinimaxResultsForPrompt(
  query: string,
  response: MinimaxSearchResponse | null,
  options: { maxItems?: number; maxSnippetChars?: number } = {}
): string {
  if (!response || response.results.length === 0) return "";

  const maxItems = options.maxItems ?? 6;
  const maxSnippet = options.maxSnippetChars ?? 240;
  const items = response.results.slice(0, maxItems);

  const lines: string[] = [
    `## 实时搜索结果(MiniMax web search,query="${query}")`,
    "",
    "下面是从公开网络拉取到的真实信息片段。引用其中事实时,**必须在文中标注 [N] 编号**(N 对应下方序号),让用户能溯源。如果某个具体细节不在下面的片段里,不要凭空添加。",
    "",
  ];
  items.forEach((r, i) => {
    const trimmed =
      r.snippet.length > maxSnippet
        ? r.snippet.slice(0, maxSnippet) + "…"
        : r.snippet;
    lines.push(`[${i + 1}] **${r.title}**${r.date ? ` (${r.date})` : ""}`);
    lines.push(`    ${trimmed}`);
    lines.push(`    URL: ${r.link}`);
    lines.push("");
  });
  return lines.join("\n");
}

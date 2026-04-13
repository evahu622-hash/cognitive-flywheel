import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export { buildKnowledgeSearchText } from "./retrieval-text.mjs";
import { createServerSupabase } from "./supabase-server";
import { generateText } from "ai";
import { getModel } from "./models";
import { cleanAIResponse } from "./utils";

type AppSupabase = SupabaseClient<Database>;
type KnowledgeRow = Database["public"]["Tables"]["knowledge_items"]["Row"];
type LexicalKnowledgeMatch =
  Database["public"]["Functions"]["search_knowledge_lexical"]["Returns"][number];
type KnowledgeSearchFields = Pick<
  KnowledgeRow,
  | "id"
  | "type"
  | "title"
  | "summary"
  | "tags"
  | "domain"
  | "source_url"
  | "raw_content"
  | "created_at"
> & {
  lexical_score?: number | null;
};

const FULL_KNOWLEDGE_SELECT =
  "id, type, title, summary, tags, domain, source_url, raw_content, created_at";

// LLM Index 候选池上限。全文搜索先做粗筛，LLM 对候选池再精排
const LLM_INDEX_CANDIDATE_LIMIT = 500;

export type RetrievalSource = "lexical" | "llm" | "hybrid";

export interface RetrievedKnowledgeItem {
  id: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  domain: string;
  source_url: string | null;
  raw_content: string | null;
  created_at: string;
  retrieval_source: RetrievalSource;
  lexical_score: number | null;
  /** LLM 判定的相关性分数（0-1），null 表示未经 LLM 评分 */
  llm_relevance: number | null;
}

interface SearchKnowledgeOptions {
  supabase?: AppSupabase;
  limit?: number;
  domain?: string | null;
  /** LLM Index 候选池大小，默认 500，小于 limit 时按 limit 放大 */
  candidatePoolSize?: number;
}

function normalizeQueryText(queryText: string) {
  return queryText.trim().replace(/\s+/g, " ").slice(0, 500);
}

function buildFallbackSearchTokens(queryText: string) {
  const normalized = normalizeQueryText(queryText);
  if (!normalized) return [];

  const sanitized = normalized.replace(/[^0-9A-Za-z\u4e00-\u9fff\s-]+/g, " ");
  const wordTokens = sanitized
    .split(/\s+/)
    .filter((token) => token.length >= 2 && token.length <= 48);
  const cjkPhrases = (normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []).filter(
    (token) => token.length <= 48
  );
  const exactQueryToken = normalized.length <= 80 ? [normalized] : [];

  return [...new Set([...exactQueryToken, ...wordTokens, ...cjkPhrases])].slice(
    0,
    6
  );
}

function mapLexicalResult(
  item: LexicalKnowledgeMatch | KnowledgeSearchFields
): RetrievedKnowledgeItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    summary: item.summary,
    tags: item.tags ?? [],
    domain: item.domain,
    source_url: item.source_url ?? null,
    raw_content: item.raw_content ?? null,
    created_at: item.created_at,
    retrieval_source: "lexical",
    lexical_score: "lexical_score" in item ? item.lexical_score ?? null : null,
    llm_relevance: null,
  };
}

function mergeRetrievedKnowledge(
  lexicalResults: RetrievedKnowledgeItem[],
  llmResults: RetrievedKnowledgeItem[]
) {
  const llmById = new Map(llmResults.map((item) => [item.id, item] as const));
  const hybridResults: RetrievedKnowledgeItem[] = [];
  const lexicalOnlyResults: RetrievedKnowledgeItem[] = [];

  for (const item of lexicalResults) {
    const llmMatch = llmById.get(item.id);
    if (llmMatch) {
      hybridResults.push({
        ...item,
        retrieval_source: "hybrid",
        llm_relevance: llmMatch.llm_relevance,
      });
      llmById.delete(item.id);
    } else {
      lexicalOnlyResults.push(item);
    }
  }

  return [...hybridResults, ...lexicalOnlyResults, ...llmById.values()];
}

async function getSupabaseClient(provided?: AppSupabase) {
  return provided ?? createServerSupabase();
}

async function hydrateKnowledgeResults(
  supabase: AppSupabase,
  items: RetrievedKnowledgeItem[]
) {
  const missingIds = items
    .filter((item) => item.source_url === null && item.raw_content === null)
    .map((item) => item.id);

  if (missingIds.length === 0) {
    return items;
  }

  const { data, error } = await supabase
    .from("knowledge_items")
    .select(FULL_KNOWLEDGE_SELECT)
    .in("id", missingIds);

  if (error || !data) {
    console.warn("Knowledge hydration degraded:", error);
    return items;
  }

  const rowsById = new Map(data.map((row) => [row.id, row]));

  return items.map((item) => {
    const hydrated = rowsById.get(item.id);
    if (!hydrated) return item;

    return {
      ...item,
      source_url: hydrated.source_url ?? item.source_url,
      raw_content: hydrated.raw_content ?? item.raw_content,
    };
  });
}

async function fallbackLexicalSearch(
  supabase: AppSupabase,
  queryText: string,
  limit: number,
  domain?: string | null
) {
  const tokens = buildFallbackSearchTokens(queryText);
  if (tokens.length === 0) {
    return [];
  }

  let query = supabase
    .from("knowledge_items")
    .select(FULL_KNOWLEDGE_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (domain) {
    query = query.eq("domain", domain);
  }

  query = query.or(
    tokens
      .flatMap((token) => [
        `title.ilike.%${token}%`,
        `summary.ilike.%${token}%`,
        `raw_content.ilike.%${token}%`,
      ])
      .join(",")
  );

  const { data, error } = await query;

  if (error) {
    console.warn("Fallback lexical search error:", error);
    return [];
  }

  return (data ?? []).map((item) => mapLexicalResult(item));
}

export async function searchKnowledgeLexical(
  queryText: string,
  options: Pick<SearchKnowledgeOptions, "supabase" | "limit" | "domain"> = {}
) {
  const supabase = await getSupabaseClient(options.supabase);
  const normalizedQuery = normalizeQueryText(queryText);
  const limit = Math.max(1, options.limit ?? 5);

  if (!normalizedQuery) {
    return [];
  }

  const { data, error } = await supabase.rpc("search_knowledge_lexical", {
    query_text: normalizedQuery,
    match_count: limit,
    filter_domain: options.domain ?? null,
  });

  if (error) {
    console.warn("Lexical search RPC error, falling back to ILIKE search:", error);
    return fallbackLexicalSearch(
      supabase,
      normalizedQuery,
      limit,
      options.domain ?? null
    );
  }

  return (data ?? []).map((item) => mapLexicalResult(item));
}

// ============================================================
// LLM Index 检索：全文粗筛 + LLM 精排
// 不再使用 embedding 向量检索
// ============================================================

async function loadCandidatePool(
  supabase: AppSupabase,
  queryText: string,
  poolSize: number,
  domain?: string | null
) {
  // 先用全文搜索做粗筛（扩大 limit，确保召回）
  const lexicalCandidates = await searchKnowledgeLexical(queryText, {
    supabase,
    limit: Math.min(poolSize, 50),
    domain,
  });
  const lexicalIds = new Set(lexicalCandidates.map((item) => item.id));

  // 再按时间倒序补充最近的内容，保证新知识进入候选池
  let recentQuery = supabase
    .from("knowledge_items")
    .select(FULL_KNOWLEDGE_SELECT)
    .order("created_at", { ascending: false })
    .limit(poolSize);
  if (domain) {
    recentQuery = recentQuery.eq("domain", domain);
  }
  const { data: recentItems, error } = await recentQuery;
  if (error) {
    console.warn("Candidate pool recent query failed:", error);
    return lexicalCandidates.map((item) => ({ ...item }));
  }

  const mergedItems: RetrievedKnowledgeItem[] = [...lexicalCandidates];
  for (const row of recentItems ?? []) {
    if (lexicalIds.has(row.id)) continue;
    mergedItems.push(mapLexicalResult(row));
  }
  return mergedItems.slice(0, poolSize);
}

async function searchKnowledgeByLLMIndex(
  supabase: AppSupabase,
  queryText: string,
  limit: number,
  domain?: string | null,
  candidatePoolSize = LLM_INDEX_CANDIDATE_LIMIT
): Promise<RetrievedKnowledgeItem[]> {
  const poolSize = Math.max(limit * 4, candidatePoolSize);
  const candidates = await loadCandidatePool(
    supabase,
    queryText,
    poolSize,
    domain
  );
  if (candidates.length === 0) {
    return [];
  }

  // 候选池数量 <= limit 直接返回（无需精排）
  if (candidates.length <= limit) {
    return candidates.map((item) => ({
      ...item,
      retrieval_source: "llm" as RetrievalSource,
      llm_relevance: null,
    }));
  }

  // 构建 index 文本
  const indexText = candidates
    .map(
      (item, i) =>
        `[${i}] [${item.domain}] ${item.title} — ${item.summary.slice(0, 80)} #${(item.tags ?? []).join(" #")}`
    )
    .join("\n");

  try {
    const model = getModel("light");
    const { text } = await generateText({
      model,
      system: `你是知识检索引擎。基于用户的查询，从知识索引中找出最相关的条目并给出相关度打分。
"相关"不仅是表面关键词匹配，更包括：
- 讨论相同主题但用不同术语的条目
- 从不同领域提供类似洞察的条目
- 可以帮助回答查询或提供有价值背景的条目
只返回 JSON 数组，每项为 {"i": 编号, "score": 0-1 相关度}，不要包含 markdown 代码块。`,
      prompt: `查询: ${queryText.slice(0, 300)}

知识索引（共 ${candidates.length} 条）:
${indexText}

返回最相关的 ${limit} 条，格式: [{"i":0,"score":0.92},{"i":3,"score":0.81}]`,
    });

    const cleaned = cleanAIResponse(text);
    const parsed = JSON.parse(cleaned) as Array<{ i: number; score: number }>;

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (r) =>
          r &&
          typeof r.i === "number" &&
          r.i >= 0 &&
          r.i < candidates.length &&
          typeof r.score === "number"
      )
      .slice(0, limit)
      .map((r) => ({
        ...candidates[r.i],
        retrieval_source: "llm" as RetrievalSource,
        llm_relevance: Math.max(0, Math.min(1, r.score)),
      }));
  } catch (error) {
    console.warn("LLM index search failed:", error);
    return [];
  }
}

export async function searchKnowledge(
  queryText: string,
  options: SearchKnowledgeOptions = {}
) {
  const supabase = await getSupabaseClient(options.supabase);
  const normalizedQuery = normalizeQueryText(queryText);
  const limit = Math.max(1, options.limit ?? 5);

  if (!normalizedQuery) {
    return [];
  }

  // 全文搜索 + LLM Index 并行
  const [lexicalResults, llmResults] = await Promise.all([
    searchKnowledgeLexical(normalizedQuery, {
      supabase,
      limit,
      domain: options.domain ?? null,
    }),
    searchKnowledgeByLLMIndex(
      supabase,
      normalizedQuery,
      limit,
      options.domain ?? null,
      options.candidatePoolSize
    ),
  ]);

  const mergedResults = mergeRetrievedKnowledge(lexicalResults, llmResults).slice(
    0,
    limit
  );

  return hydrateKnowledgeResults(supabase, mergedResults);
}

export function summarizeRetrievalSources(items: RetrievedKnowledgeItem[]) {
  return items.reduce<Record<RetrievalSource, number>>(
    (acc, item) => {
      acc[item.retrieval_source] += 1;
      return acc;
    },
    { lexical: 0, llm: 0, hybrid: 0 }
  );
}

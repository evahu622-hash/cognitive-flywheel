import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export { buildKnowledgeSearchText } from "./retrieval-text.mjs";
import {
  findSimilarKnowledge,
  generateEmbedding,
  isEmbeddingConfigured,
} from "./embeddings";
import { createServerSupabase } from "./supabase-server";
import { generateText } from "ai";
import { getModel } from "./models";
import { cleanAIResponse } from "./utils";

type AppSupabase = SupabaseClient<Database>;
type KnowledgeRow = Database["public"]["Tables"]["knowledge_items"]["Row"];
type LexicalKnowledgeMatch =
  Database["public"]["Functions"]["search_knowledge_lexical"]["Returns"][number];
type SemanticKnowledgeMatch =
  Database["public"]["Functions"]["match_knowledge"]["Returns"][number];
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
const DEFAULT_SEMANTIC_THRESHOLD = 0.45;

export type RetrievalSource = "lexical" | "semantic" | "hybrid";

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
  similarity: number | null;
}

interface SearchKnowledgeOptions {
  supabase?: AppSupabase;
  limit?: number;
  domain?: string | null;
  includeSemantic?: boolean;
  semanticThreshold?: number;
  semanticQueryText?: string;
  queryEmbedding?: number[] | null;
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
    similarity: null,
  };
}

function mapSemanticResult(item: SemanticKnowledgeMatch): RetrievedKnowledgeItem {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    summary: item.summary,
    tags: item.tags ?? [],
    domain: item.domain,
    source_url: null,
    raw_content: null,
    created_at: item.created_at,
    retrieval_source: "semantic",
    lexical_score: null,
    similarity: item.similarity,
  };
}

function mergeRetrievedKnowledge(
  lexicalResults: RetrievedKnowledgeItem[],
  semanticResults: RetrievedKnowledgeItem[]
) {
  const semanticById = new Map(
    semanticResults.map((item) => [item.id, item] as const)
  );
  const hybridResults: RetrievedKnowledgeItem[] = [];
  const lexicalOnlyResults: RetrievedKnowledgeItem[] = [];

  for (const item of lexicalResults) {
    const semanticMatch = semanticById.get(item.id);
    if (semanticMatch) {
      hybridResults.push({
        ...item,
        retrieval_source: "hybrid",
        similarity: semanticMatch.similarity,
      });
      semanticById.delete(item.id);
    } else {
      lexicalOnlyResults.push(item);
    }
  }

  return [...hybridResults, ...lexicalOnlyResults, ...semanticById.values()];
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

// ── LLM Index 搜索 ───────────────────────────────────────────
// 用 LLM 读取知识库索引，判断哪些条目与查询相关
// 替代 embedding 语义搜索，理解意图而非仅匹配相似度

async function searchKnowledgeByLLMIndex(
  supabase: AppSupabase,
  queryText: string,
  limit: number,
  domain?: string | null
): Promise<RetrievedKnowledgeItem[]> {
  // 构建 index：每条知识一行摘要
  let query = supabase
    .from("knowledge_items")
    .select("id, type, title, summary, tags, domain, source_url, raw_content, created_at")
    .order("created_at", { ascending: false })
    .limit(200); // 最多读 200 条，约 10-20k tokens

  if (domain) {
    query = query.eq("domain", domain);
  }

  const { data: items, error } = await query;
  if (error || !items || items.length === 0) {
    return [];
  }

  // 如果条目很少（<= limit），直接全部返回，不需要 LLM 筛选
  if (items.length <= limit) {
    return items.map((item) => ({
      ...item,
      tags: item.tags ?? [],
      source_url: item.source_url ?? null,
      raw_content: item.raw_content ?? null,
      retrieval_source: "lexical" as RetrievalSource,
      lexical_score: null,
      similarity: null,
    }));
  }

  // 构建 index 文本
  const indexText = items
    .map(
      (item, i) =>
        `[${i}] [${item.domain}] ${item.title} — ${item.summary.slice(0, 80)} #${(item.tags ?? []).join(" #")}`
    )
    .join("\n");

  try {
    const model = getModel("light");
    const { text } = await generateText({
      model,
      system: `你是知识检索引擎。基于用户的查询，从知识索引中找出最相关的条目。
"相关"不仅是表面关键词匹配，更包括：
- 讨论相同主题但用不同术语的条目
- 从不同领域提供类似洞察的条目
- 可以帮助回答查询或提供有价值背景的条目
只返回 JSON 数组（条目编号），不要包含 markdown 代码块。`,
      prompt: `查询: ${queryText.slice(0, 300)}

知识索引（共 ${items.length} 条）:
${indexText}

返回最相关的 ${limit} 条的编号，格式: [0, 3, 7]`,
    });

    const cleaned = cleanAIResponse(text);
    const indices = JSON.parse(cleaned) as number[];

    if (!Array.isArray(indices)) return [];

    return indices
      .filter((i) => typeof i === "number" && i >= 0 && i < items.length)
      .slice(0, limit)
      .map((i) => ({
        ...items[i],
        tags: items[i].tags ?? [],
        source_url: items[i].source_url ?? null,
        raw_content: items[i].raw_content ?? null,
        retrieval_source: "semantic" as RetrievalSource, // 标记为 semantic 因为是意图理解
        lexical_score: null,
        similarity: 0.8, // LLM 判定相关，给一个默认置信度
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

  // 策略：全文搜索 + LLM Index 搜索（或 Embedding 搜索）并行
  const lexicalResults = await searchKnowledgeLexical(normalizedQuery, {
    supabase,
    limit,
    domain: options.domain ?? null,
  });

  let semanticResults: RetrievedKnowledgeItem[] = [];

  // 优先使用 Embedding（如果可用），否则用 LLM Index 搜索
  const useEmbedding =
    options.includeSemantic !== false && isEmbeddingConfigured();

  if (useEmbedding) {
    try {
      const queryEmbedding =
        options.queryEmbedding ??
        (await generateEmbedding(options.semanticQueryText ?? normalizedQuery));
      const similarKnowledge = await findSimilarKnowledge(queryEmbedding, {
        limit,
        threshold: options.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD,
        domain: options.domain ?? null,
      });

      semanticResults = similarKnowledge.map((item) => mapSemanticResult(item));
    } catch (error) {
      console.warn("Semantic search degraded, falling back to LLM index:", error);
      semanticResults = await searchKnowledgeByLLMIndex(
        supabase,
        normalizedQuery,
        limit,
        options.domain ?? null
      );
    }
  } else {
    // 无 Embedding，使用 LLM Index 搜索
    semanticResults = await searchKnowledgeByLLMIndex(
      supabase,
      normalizedQuery,
      limit,
      options.domain ?? null
    );
  }

  const mergedResults = mergeRetrievedKnowledge(
    lexicalResults,
    semanticResults
  ).slice(0, limit);

  return hydrateKnowledgeResults(supabase, mergedResults);
}

export function summarizeRetrievalSources(items: RetrievedKnowledgeItem[]) {
  return items.reduce<Record<RetrievalSource, number>>(
    (acc, item) => {
      acc[item.retrieval_source] += 1;
      return acc;
    },
    { lexical: 0, semantic: 0, hybrid: 0 }
  );
}

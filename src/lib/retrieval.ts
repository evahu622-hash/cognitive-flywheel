import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
export { buildKnowledgeSearchText } from "./retrieval-text.mjs";
import {
  findSimilarKnowledge,
  generateEmbedding,
  isEmbeddingConfigured,
} from "./embeddings";
import { createServerSupabase } from "./supabase-server";

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

  const lexicalResults = await searchKnowledgeLexical(normalizedQuery, {
    supabase,
    limit,
    domain: options.domain ?? null,
  });

  let semanticResults: RetrievedKnowledgeItem[] = [];
  const shouldUseSemantic =
    options.includeSemantic !== false && isEmbeddingConfigured();

  if (shouldUseSemantic) {
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
      console.warn("Semantic search degraded:", error);
    }
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

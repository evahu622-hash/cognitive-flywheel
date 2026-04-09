import { createServerSupabase } from "./supabase-server";

// ============================================================
// 向量嵌入服务
// 支持 MiniMax / Jina / OpenAI，优先使用已配置的
// ============================================================

const DEFAULT_PROVIDER_ORDER = ["openai", "minimax", "jina"] as const;

type EmbeddingProvider = (typeof DEFAULT_PROVIDER_ORDER)[number];

function getMiniMaxEmbeddingKey() {
  return process.env.MINIMAX_EMBED_API_KEY ?? process.env.MINIMAX_API_KEY;
}

function isEmbeddingsDisabled() {
  return process.env.AI_DISABLE_EMBEDDINGS === "1";
}

function isMiniMaxCodingPlanKey(key: string | undefined) {
  return typeof key === "string" && key.startsWith("sk-cp-");
}

function getProviderOrder(): EmbeddingProvider[] {
  const configuredOrder = process.env.AI_EMBED_PROVIDER_ORDER
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(
      (value): value is EmbeddingProvider =>
        DEFAULT_PROVIDER_ORDER.includes(value as EmbeddingProvider)
    );

  if (!configuredOrder || configuredOrder.length === 0) {
    return [...DEFAULT_PROVIDER_ORDER];
  }

  const missingProviders = DEFAULT_PROVIDER_ORDER.filter(
    (provider) => !configuredOrder.includes(provider)
  );

  return [...configuredOrder, ...missingProviders];
}

/** 检查嵌入功能是否可用 */
export function isEmbeddingConfigured(): boolean {
  if (isEmbeddingsDisabled()) {
    return false;
  }

  return !!(
    (getMiniMaxEmbeddingKey() &&
      !isMiniMaxCodingPlanKey(getMiniMaxEmbeddingKey())) ||
    process.env.OPENAI_API_KEY ||
    process.env.JINA_API_KEY
  );
}

/** 生成文本的向量嵌入 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (isEmbeddingsDisabled()) {
    throw new Error("Embeddings are disabled by AI_DISABLE_EMBEDDINGS=1");
  }

  const providers: Record<
    EmbeddingProvider,
    {
      name: string;
      enabled: boolean;
      fn: () => Promise<number[]>;
    }
  > = {
    minimax: {
      name: "MiniMax",
      enabled:
        Boolean(getMiniMaxEmbeddingKey()) &&
        !isMiniMaxCodingPlanKey(getMiniMaxEmbeddingKey()),
      fn: () => generateMiniMaxEmbedding(text),
    },
    openai: {
      name: "OpenAI",
      enabled: Boolean(process.env.OPENAI_API_KEY),
      fn: () => generateOpenAIEmbedding(text),
    },
    jina: {
      name: "Jina",
      enabled: Boolean(process.env.JINA_API_KEY),
      fn: () => generateJinaEmbedding(text),
    },
  };
  const attempts = getProviderOrder().map((provider) => providers[provider]);

  const failures: string[] = [];

  for (const attempt of attempts) {
    if (!attempt.enabled) continue;

    try {
      return await attempt.fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${attempt.name}: ${message}`);
      console.warn(`[embedding] ${attempt.name} failed, trying next provider`, error);
    }
  }

  if (failures.length === 0) {
    if (isMiniMaxCodingPlanKey(getMiniMaxEmbeddingKey())) {
      throw new Error(
        "当前用于 embeddings 的 MiniMax Key 看起来是 Coding Plan Key（sk-cp-...），官方说明仅支持文本模型，不支持 embeddings。请为 MINIMAX_EMBED_API_KEY 配置普通按量付费 Key，或配置 OPENAI_API_KEY，或关闭 embeddings。"
      );
    }
    throw new Error("未配置 Embedding API Key");
  }

  throw new Error(`所有 Embedding Provider 都失败了: ${failures.join(" | ")}`);
}

async function generateOpenAIEmbedding(text: string): Promise<number[]> {
  const { embed } = await import("ai");
  const { getEmbeddingModel } = await import("./models");
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
  });
  return embedding;
}

/** MiniMax Embedding API (embo-01, 1536维) */
async function generateMiniMaxEmbedding(text: string): Promise<number[]> {
  const apiKey = getMiniMaxEmbeddingKey();
  const res = await fetch("https://api.minimaxi.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "embo-01",
      texts: [text],
      type: "db",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax Embedding error: ${res.status} ${err}`);
  }

  const data = await res.json();
  if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
    throw new Error(`MiniMax Embedding error: ${data.base_resp.status_msg}`);
  }
  return data.vectors[0];
}

/** Jina Embeddings API (v3, 768维) */
async function generateJinaEmbedding(text: string): Promise<number[]> {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      input: [text],
      dimensions: 768,
      task: "text-matching",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jina Embedding error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

/** 向量相似度搜索，找到与查询最相关的知识条目 */
export async function findSimilarKnowledge(
  queryEmbedding: number[],
  options?: {
    threshold?: number;
    limit?: number;
    domain?: string | null;
  }
): Promise<
  {
    id: string;
    type: string;
    title: string;
    summary: string;
    tags: string[];
    domain: string;
    created_at: string;
    similarity: number;
  }[]
> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc("match_knowledge", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_threshold: options?.threshold ?? 0.7,
    match_count: options?.limit ?? 5,
    filter_domain: options?.domain ?? null,
  });

  if (error) {
    console.error("Vector search error:", error);
    return [];
  }
  return data ?? [];
}

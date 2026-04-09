import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

const env = {
  ...readEnvFile(path.join(process.cwd(), ".env.local")),
  ...process.env,
};

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Input not found: ${filePath}`);
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeQueryText(queryText) {
  return String(queryText ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function buildFallbackSearchTokens(queryText) {
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

function summarizeMessage(message) {
  const normalized = String(message ?? "");
  return normalized.length > 400
    ? `${normalized.slice(0, 400)}...`
    : normalized;
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMiniMaxCodingPlanKey(key) {
  return typeof key === "string" && key.startsWith("sk-cp-");
}

function getMiniMaxEmbeddingKey() {
  return env.MINIMAX_EMBED_API_KEY || env.MINIMAX_API_KEY || "";
}

function getEmbeddingProviderOrder() {
  const fallback = ["openai", "minimax", "jina"];
  const configured = parseCsv(env.AI_EMBED_PROVIDER_ORDER).map((item) =>
    item.toLowerCase()
  );
  const valid = configured.filter((item) => fallback.includes(item));
  return [...valid, ...fallback.filter((item) => !valid.includes(item))];
}

async function generateOpenAIEmbedding(text) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OpenAI embeddings 未配置");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.AI_EMBED_MODEL || "text-embedding-3-small",
      input: text,
    }),
  });

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  if (!response.ok || !parsed?.data?.[0]?.embedding) {
    throw new Error(
      summarizeMessage(parsed?.error?.message ?? parsed?.raw ?? body)
    );
  }

  return parsed.data[0].embedding;
}

async function generateMiniMaxEmbedding(text) {
  const apiKey = getMiniMaxEmbeddingKey();
  if (!apiKey) {
    throw new Error("MiniMax embeddings 未配置");
  }

  if (isMiniMaxCodingPlanKey(apiKey)) {
    throw new Error("MiniMax Coding Plan Key 不支持 embeddings");
  }

  const response = await fetch("https://api.minimaxi.com/v1/embeddings", {
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

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  if (
    !response.ok ||
    (parsed?.base_resp?.status_code !== 0 &&
      parsed?.base_resp?.status_code !== undefined)
  ) {
    throw new Error(
      summarizeMessage(
        parsed?.base_resp?.status_msg ?? parsed?.detail ?? parsed?.raw ?? body
      )
    );
  }

  return parsed.vectors?.[0];
}

async function generateJinaEmbedding(text) {
  if (!env.JINA_API_KEY) {
    throw new Error("Jina embeddings 未配置");
  }

  const response = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      input: [text],
      dimensions: 768,
      task: "text-matching",
    }),
  });

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  if (!response.ok || !parsed?.data?.[0]?.embedding) {
    throw new Error(
      summarizeMessage(parsed?.detail ?? parsed?.message ?? parsed?.raw ?? body)
    );
  }

  return parsed.data[0].embedding;
}

async function generateEmbedding(text) {
  if (env.AI_DISABLE_EMBEDDINGS === "1") {
    throw new Error("Embeddings are disabled by AI_DISABLE_EMBEDDINGS=1");
  }

  const providers = {
    openai: {
      enabled: Boolean(env.OPENAI_API_KEY),
      fn: () => generateOpenAIEmbedding(text),
    },
    minimax: {
      enabled:
        Boolean(getMiniMaxEmbeddingKey()) &&
        !isMiniMaxCodingPlanKey(getMiniMaxEmbeddingKey()),
      fn: () => generateMiniMaxEmbedding(text),
    },
    jina: {
      enabled: Boolean(env.JINA_API_KEY),
      fn: () => generateJinaEmbedding(text),
    },
  };

  const failures = [];

  for (const provider of getEmbeddingProviderOrder()) {
    const attempt = providers[provider];
    if (!attempt?.enabled) continue;

    try {
      return await attempt.fn();
    } catch (error) {
      failures.push(`${provider}: ${error.message}`);
    }
  }

  if (failures.length === 0) {
    throw new Error("No embedding provider configured");
  }

  throw new Error(`All embedding providers failed: ${failures.join(" | ")}`);
}

function parseEmbedding(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(Number);

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    const cleaned = String(value).trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!cleaned) return null;
    const numbers = cleaned.split(",").map((item) => Number(item.trim()));
    return numbers.every((number) => Number.isFinite(number)) ? numbers : null;
  }
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return null;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return null;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function mergeResults(lexicalResults, semanticResults, limit) {
  const semanticById = new Map(semanticResults.map((item) => [item.id, item]));
  const merged = [];

  for (const item of lexicalResults) {
    const semantic = semanticById.get(item.id);
    if (semantic) {
      merged.push({
        ...item,
        retrieval_source: "hybrid",
        similarity: semantic.similarity,
      });
      semanticById.delete(item.id);
    } else {
      merged.push({
        ...item,
        retrieval_source: "lexical",
      });
    }
  }

  for (const item of semanticById.values()) {
    merged.push({
      ...item,
      retrieval_source: "semantic",
    });
  }

  return merged.slice(0, limit);
}

function computeMetrics(results, goldItemIds, acceptableItemIds, bestItemId, k) {
  const topK = results.slice(0, k);
  const goldSet = new Set(goldItemIds);
  const acceptableSet = new Set(
    acceptableItemIds.length > 0 ? acceptableItemIds : goldItemIds
  );

  const recallAtK = topK.some((item) => goldSet.has(item.id)) ? 1 : 0;
  const firstRelevantIndex = results.findIndex((item) => acceptableSet.has(item.id));
  const mrr = firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : 0;
  const bestIndex = bestItemId
    ? results.findIndex((item) => item.id === bestItemId)
    : -1;
  const irrelevantCount = topK.filter((item) => !acceptableSet.has(item.id)).length;
  const noiseRate = topK.length > 0 ? irrelevantCount / topK.length : 0;

  return {
    retrievedCount: results.length,
    recall_at_k: recallAtK,
    mrr,
    noise_rate: noiseRate,
    first_relevant_rank: firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null,
    best_rank: bestIndex >= 0 ? bestIndex + 1 : null,
  };
}

function aggregateStrategy(results) {
  const total = results.length;
  const summary = {
    total_queries: total,
    retrieval_recall_at_5: 0,
    retrieval_mrr: 0,
    retrieval_noise_rate: 0,
    hit_count: 0,
    miss_count: 0,
  };

  if (total === 0) {
    return summary;
  }

  for (const item of results) {
    summary.retrieval_recall_at_5 += item.metrics.recall_at_k;
    summary.retrieval_mrr += item.metrics.mrr;
    summary.retrieval_noise_rate += item.metrics.noise_rate;
    if (item.metrics.recall_at_k > 0) {
      summary.hit_count += 1;
    } else {
      summary.miss_count += 1;
    }
  }

  summary.retrieval_recall_at_5 /= total;
  summary.retrieval_mrr /= total;
  summary.retrieval_noise_rate /= total;

  return summary;
}

function ensureDatasetRow(row, index, defaultUserId) {
  const userId = row.user_id || defaultUserId || null;
  const query = normalizeQueryText(row.query);
  const goldItemIds = ensureArray(row.gold_item_ids);
  const acceptableItemIds = ensureArray(row.acceptable_item_ids);
  const bestItemId = row.best_item_id || goldItemIds[0] || null;

  if (!userId) {
    throw new Error(`Row ${index + 1}: missing user_id`);
  }

  if (!isUuid(userId)) {
    throw new Error(`Row ${index + 1}: invalid user_id "${userId}"`);
  }

  if (!query) {
    throw new Error(`Row ${index + 1}: missing query`);
  }

  if (goldItemIds.length === 0) {
    throw new Error(`Row ${index + 1}: missing gold_item_ids`);
  }

  return {
    id: row.id || `retrieval-${index + 1}`,
    user_id: userId,
    query,
    domain: row.domain || null,
    gold_item_ids: goldItemIds,
    acceptable_item_ids: acceptableItemIds,
    best_item_id: bestItemId,
    notes: row.notes || null,
  };
}

async function loadUserKnowledge(supabase, userId) {
  const { data, error } = await supabase
    .from("knowledge_items")
    .select(
      "id, type, title, summary, tags, domain, source_url, raw_content, created_at, embedding, user_id"
    )
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to load knowledge_items: ${error.message}`);
  }

  return (data ?? []).map((item) => ({
    ...item,
    tags: ensureArray(item.tags),
    parsed_embedding: parseEmbedding(item.embedding),
  }));
}

async function lexicalSearch(supabase, row, limit) {
  const { data, error } = await supabase.rpc("search_knowledge_lexical_for_eval", {
    target_user_id: row.user_id,
    query_text: row.query,
    match_count: limit,
    filter_domain: row.domain,
  });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((item) => ({
    ...item,
    tags: ensureArray(item.tags),
    lexical_score: item.lexical_score ?? null,
    similarity: null,
  }));
}

function localLexicalSearch(userKnowledge, row, limit) {
  const tokens = buildFallbackSearchTokens(row.query);
  if (tokens.length === 0) {
    return [];
  }

  const results = userKnowledge
    .filter((item) => !row.domain || item.domain === row.domain)
    .map((item) => {
      const title = String(item.title ?? "").toLowerCase();
      const summary = String(item.summary ?? "").toLowerCase();
      const tags = ensureArray(item.tags).join(" ").toLowerCase();
      const rawContent = String(item.raw_content ?? "").toLowerCase();

      let lexicalScore = 0;

      for (const token of tokens) {
        const normalizedToken = token.toLowerCase();
        if (title.includes(normalizedToken)) lexicalScore += 5;
        if (tags.includes(normalizedToken)) lexicalScore += 4;
        if (summary.includes(normalizedToken)) lexicalScore += 3;
        if (rawContent.includes(normalizedToken)) lexicalScore += 1;
      }

      return {
        id: item.id,
        type: item.type,
        title: item.title,
        summary: item.summary,
        tags: item.tags,
        domain: item.domain,
        source_url: item.source_url,
        raw_content: item.raw_content,
        created_at: item.created_at,
        lexical_score: lexicalScore > 0 ? lexicalScore : null,
        similarity: null,
      };
    })
    .filter((item) => item.lexical_score != null)
    .sort((a, b) => {
      if (b.lexical_score !== a.lexical_score) {
        return b.lexical_score - a.lexical_score;
      }
      return String(b.created_at).localeCompare(String(a.created_at));
    })
    .slice(0, limit);

  return results;
}

async function semanticSearch(userKnowledge, row, limit, semanticThreshold) {
  const queryEmbedding = await generateEmbedding(row.query);

  return userKnowledge
    .filter((item) => !row.domain || item.domain === row.domain)
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      summary: item.summary,
      tags: item.tags,
      domain: item.domain,
      source_url: item.source_url,
      raw_content: item.raw_content,
      created_at: item.created_at,
      lexical_score: null,
      similarity: cosineSimilarity(queryEmbedding, item.parsed_embedding),
    }))
    .filter((item) => item.similarity != null && item.similarity > semanticThreshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

async function runStrategy({
  strategy,
  rows,
  supabase,
  userKnowledgeByUserId,
  limit,
  semanticThreshold,
}) {
  const results = [];

  for (const row of rows) {
    const userKnowledge = userKnowledgeByUserId.get(row.user_id) ?? [];
    let lexicalResults;

    try {
      lexicalResults = await lexicalSearch(supabase, row, limit);
    } catch (error) {
      if (
        error.message.includes(
          "Could not find the function public.search_knowledge_lexical_for_eval"
        )
      ) {
        lexicalResults = localLexicalSearch(userKnowledge, row, limit);
      } else {
        throw error;
      }
    }

    let finalResults = lexicalResults;
    let semanticError = null;

    if (strategy === "hybrid") {
      try {
        const semanticResults = await semanticSearch(
          userKnowledge,
          row,
          limit,
          semanticThreshold
        );
        finalResults = mergeResults(lexicalResults, semanticResults, limit);
      } catch (error) {
        semanticError = error.message;
      }
    }

    const metrics = computeMetrics(
      finalResults,
      row.gold_item_ids,
      row.acceptable_item_ids,
      row.best_item_id,
      limit
    );

    results.push({
      dataset_row_id: row.id,
      user_id: row.user_id,
      query: row.query,
      strategy,
      domain: row.domain,
      gold_item_ids: row.gold_item_ids,
      acceptable_item_ids:
        row.acceptable_item_ids.length > 0
          ? row.acceptable_item_ids
          : row.gold_item_ids,
      best_item_id: row.best_item_id,
      metrics,
      semantic_error: semanticError,
      hits: finalResults.map((item, index) => ({
        rank: index + 1,
        id: item.id,
        title: item.title,
        domain: item.domain,
        retrieval_source: item.retrieval_source ?? "lexical",
        lexical_score: item.lexical_score,
        similarity: item.similarity,
        is_gold: row.gold_item_ids.includes(item.id),
        is_acceptable:
          (row.acceptable_item_ids.length > 0
            ? row.acceptable_item_ids
            : row.gold_item_ids
          ).includes(item.id),
      })),
    });
  }

  return results;
}

function printSummary(strategy, summary) {
  console.log(`\n[${strategy}]`);
  console.log(`queries: ${summary.total_queries}`);
  console.log(
    `retrieval_recall_at_5: ${summary.retrieval_recall_at_5.toFixed(3)}`
  );
  console.log(`retrieval_mrr: ${summary.retrieval_mrr.toFixed(3)}`);
  console.log(
    `retrieval_noise_rate: ${summary.retrieval_noise_rate.toFixed(3)}`
  );
  console.log(`hit_count: ${summary.hit_count}`);
  console.log(`miss_count: ${summary.miss_count}`);
}

const inputPath = getArg(
  "input",
  path.join(process.cwd(), "evals", "datasets", "memory_retrieval_gold.jsonl")
);
const outputPath = getArg(
  "out",
  path.join(process.cwd(), "evals", "results", "retrieval-eval.json")
);
const limit = Number(getArg("limit", "5"));
const semanticThreshold = Number(getArg("semantic-threshold", "0.45"));
const strategies = parseCsv(getArg("strategies", "lexical,hybrid"));
const defaultUserId = getArg("user-id", env.TEST_USER_ID || null);
const minRecallAt5 = getArg("min-recall-at-5");
const minMrr = getArg("min-mrr");
const maxNoiseRate = getArg("max-noise-rate");

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

const rawDataset = parseJsonl(inputPath);
const dataset = rawDataset.map((row, index) =>
  ensureDatasetRow(row, index, defaultUserId)
);

const userIds = [...new Set(dataset.map((row) => row.user_id))];
const userKnowledgeByUserId = new Map();

for (const userId of userIds) {
  userKnowledgeByUserId.set(userId, await loadUserKnowledge(supabase, userId));
}

const strategyResults = {};
const summaryByStrategy = {};

for (const strategy of strategies) {
  if (strategy !== "lexical" && strategy !== "hybrid") {
    console.error(`Unsupported strategy: ${strategy}`);
    process.exit(1);
  }

  const results = await runStrategy({
    strategy,
    rows: dataset,
    supabase,
    userKnowledgeByUserId,
    limit,
    semanticThreshold,
  });
  const summary = aggregateStrategy(results);
  strategyResults[strategy] = results;
  summaryByStrategy[strategy] = summary;
  printSummary(strategy, summary);
}

const output = {
  generated_at: new Date().toISOString(),
  input_path: inputPath,
  limit,
  semantic_threshold: semanticThreshold,
  strategies,
  summary: summaryByStrategy,
  results: strategyResults,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

let hasFailure = false;

for (const strategy of strategies) {
  const summary = summaryByStrategy[strategy];
  if (minRecallAt5 != null && summary.retrieval_recall_at_5 < Number(minRecallAt5)) {
    console.error(
      `[${strategy}] retrieval_recall_at_5 ${summary.retrieval_recall_at_5.toFixed(3)} < ${Number(minRecallAt5).toFixed(3)}`
    );
    hasFailure = true;
  }
  if (minMrr != null && summary.retrieval_mrr < Number(minMrr)) {
    console.error(
      `[${strategy}] retrieval_mrr ${summary.retrieval_mrr.toFixed(3)} < ${Number(minMrr).toFixed(3)}`
    );
    hasFailure = true;
  }
  if (
    maxNoiseRate != null &&
    summary.retrieval_noise_rate > Number(maxNoiseRate)
  ) {
    console.error(
      `[${strategy}] retrieval_noise_rate ${summary.retrieval_noise_rate.toFixed(3)} > ${Number(maxNoiseRate).toFixed(3)}`
    );
    hasFailure = true;
  }
}

console.log(`\nWrote retrieval eval results to ${outputPath}`);

if (hasFailure) {
  process.exit(1);
}

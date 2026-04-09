import fs from "node:fs";

function readEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(".env.local", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

function summarizeMessage(message) {
  return message.length > 400 ? `${message.slice(0, 400)}...` : message;
}

function isMiniMaxCodingPlanKey(key) {
  return typeof key === "string" && key.startsWith("sk-cp-");
}

function getMiniMaxEmbeddingKey(env) {
  return env.MINIMAX_EMBED_API_KEY || env.MINIMAX_API_KEY || "";
}

async function testMiniMax(env, text) {
  const embedKey = getMiniMaxEmbeddingKey(env);

  if (!embedKey) {
    return { provider: "MiniMax", enabled: false, ok: false, reason: "未配置 API Key" };
  }

  if (isMiniMaxCodingPlanKey(embedKey)) {
    return {
      provider: "MiniMax",
      enabled: false,
      ok: false,
      reason:
        "检测到 sk-cp- 前缀，疑似 Coding Plan Key。该类 key 在官方文档中说明主要用于文本模型，不建议用于 embeddings。",
    };
  }

  const response = await fetch("https://api.minimaxi.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${embedKey}`,
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

  return {
    provider: "MiniMax",
    enabled: true,
    ok: response.ok && parsed?.base_resp?.status_code === 0,
    status: response.status,
    reason: summarizeMessage(
      parsed?.base_resp?.status_msg ?? parsed?.detail ?? parsed?.raw ?? body
    ),
    raw: parsed,
  };
}

async function testJina(env, text) {
  if (!env.JINA_API_KEY) {
    return { provider: "Jina", enabled: false, ok: false, reason: "未配置 API Key" };
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

  return {
    provider: "Jina",
    enabled: true,
    ok: response.ok,
    status: response.status,
    reason: summarizeMessage(
      parsed?.detail ?? parsed?.message ?? parsed?.raw ?? body
    ),
    raw: parsed,
  };
}

async function testOpenAI(env, text) {
  if (!env.OPENAI_API_KEY) {
    return { provider: "OpenAI", enabled: false, ok: false, reason: "未配置 API Key" };
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

  return {
    provider: "OpenAI",
    enabled: true,
    ok: response.ok,
    status: response.status,
    reason: summarizeMessage(
      parsed?.error?.message ?? parsed?.raw ?? body
    ),
    raw: parsed,
  };
}

async function testMiniMaxChat(env) {
  if (!env.MINIMAX_API_KEY) {
    return { provider: "MiniMax Chat", enabled: false, ok: false, reason: "未配置 API Key" };
  }

  const response = await fetch("https://api.minimaxi.com/v1/text/chatcompletion_v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: "MiniMax-M2.1",
      messages: [
        { role: "system", name: "MiniMax AI" },
        { role: "user", name: "用户", content: "只回复 OK" },
      ],
    }),
  });

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  return {
    provider: "MiniMax Chat",
    enabled: true,
    ok: response.ok && parsed?.base_resp?.status_code === 0,
    status: response.status,
    reason: summarizeMessage(parsed?.base_resp?.status_msg ?? "OK"),
    raw: parsed,
  };
}

async function testMiniMaxCodingPlan(env) {
  if (!env.MINIMAX_API_KEY || !isMiniMaxCodingPlanKey(env.MINIMAX_API_KEY)) {
    return null;
  }

  const response = await fetch(
    "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.MINIMAX_API_KEY}`,
      },
    }
  );

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  return {
    provider: "MiniMax Coding Plan",
    enabled: true,
    ok: response.ok,
    status: response.status,
    reason: response.ok
      ? "可读取 Coding Plan 配额，说明当前 key 确实是 Coding Plan Key"
      : summarizeMessage(parsed?.raw ?? body),
    raw: parsed,
  };
}

const env = readEnv();
const text = "embedding provider smoke test";
const results = await Promise.all([
  testMiniMaxChat(env),
  testMiniMax(env, text),
  testJina(env, text),
  testOpenAI(env, text),
]);
const codingPlan = await testMiniMaxCodingPlan(env);
if (codingPlan) {
  results.splice(1, 0, codingPlan);
}

const compact = results.map((item) => ({
  provider: item.provider,
  enabled: item.enabled,
  ok: item.ok,
  status: item.status ?? null,
  reason: item.reason,
}));

console.log(JSON.stringify(compact, null, 2));

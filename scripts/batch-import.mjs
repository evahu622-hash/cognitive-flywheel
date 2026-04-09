#!/usr/bin/env node

/**
 * 批量导入 markdown 文件到知识库
 * 用法: node scripts/batch-import.mjs <目录路径>
 *
 * 直接通过 Supabase REST API 插入，不调用 AI 分析（太慢太贵）
 * 从 markdown frontmatter 提取标题、标签、日期等元数据
 * 如果 embedding 可用，会按与在线 Feed 相同的检索文本构建方式生成向量
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { buildKnowledgeSearchText } from "../src/lib/retrieval-text.mjs";

// ============================================================
// 配置
// ============================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // admin key
const USER_ID = process.env.TEST_USER_ID;
const BATCH_SIZE = 50; // 每批插入条数
const DEFAULT_EMBEDDING_PROVIDER_ORDER = ["openai", "minimax", "jina"];

function getEmbeddingProviderOrder() {
  const configuredOrder = (process.env.AI_EMBED_PROVIDER_ORDER || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .filter((value) => DEFAULT_EMBEDDING_PROVIDER_ORDER.includes(value));

  return [
    ...configuredOrder,
    ...DEFAULT_EMBEDDING_PROVIDER_ORDER.filter(
      (provider) => !configuredOrder.includes(provider)
    ),
  ];
}

if (!SUPABASE_URL || !SUPABASE_KEY || !USER_ID) {
  console.error("请设置环境变量: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_USER_ID");
  console.error("提示: source .env.local 或手动 export");
  process.exit(1);
}

const dir = process.argv[2];
if (!dir) {
  console.error("用法: node scripts/batch-import.mjs <目录路径>");
  process.exit(1);
}

// ============================================================
// 解析 Markdown Frontmatter
// ============================================================

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const m = line.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (m) {
      let value = m[2].trim();
      // 去掉引号
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // 解析数组
      if (value.startsWith("[") && value.endsWith("]")) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/"/g, ""));
        }
      }
      meta[m[1]] = value;
    }
  }

  return { meta, body: match[2].trim() };
}

// ============================================================
// 领域分类
// ============================================================

function classifyDomain(tags, title) {
  const text = `${title} ${(Array.isArray(tags) ? tags : []).join(" ")}`.toLowerCase();

  if (text.match(/invest|financ|valuation|pricing|revenue|monetiz|fundrais/)) return "投资";
  if (text.match(/ai|agent|llm|machine.?learn|gpt|model|automat/)) return "Agent Building";
  if (text.match(/health|fitness|sleep|nutrition|wellness|mental/)) return "健康";
  if (text.match(/solo|indie|bootstrap|one.?person|freelanc|creator/)) return "一人公司";
  if (text.match(/growth|product|startup|b2b|saas|market|leadership|career|design|engineer/)) return "跨领域";
  return "跨领域";
}

function getMiniMaxEmbeddingKey() {
  return process.env.MINIMAX_EMBED_API_KEY ?? process.env.MINIMAX_API_KEY;
}

function isMiniMaxCodingPlanKey(key) {
  return typeof key === "string" && key.startsWith("sk-cp-");
}

function isEmbeddingsEnabled() {
  if (process.env.AI_DISABLE_EMBEDDINGS === "1") {
    return false;
  }

  return Boolean(
    process.env.OPENAI_API_KEY ||
      process.env.JINA_API_KEY ||
      (getMiniMaxEmbeddingKey() &&
        !isMiniMaxCodingPlanKey(getMiniMaxEmbeddingKey()))
  );
}

async function generateOpenAIEmbedding(text) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.AI_EMBED_MODEL || "text-embedding-3-small",
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
    throw new Error(parsed?.error?.message || parsed?.raw || body);
  }

  return parsed.data[0].embedding;
}

async function generateMiniMaxEmbedding(text) {
  const apiKey = getMiniMaxEmbeddingKey();
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
    throw new Error(parsed?.base_resp?.status_msg || parsed?.detail || parsed?.raw || body);
  }

  return parsed.vectors?.[0];
}

async function generateJinaEmbedding(text) {
  const response = await fetch("https://api.jina.ai/v1/embeddings", {
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

  const body = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  if (!response.ok || !parsed?.data?.[0]?.embedding) {
    throw new Error(parsed?.detail || parsed?.message || parsed?.raw || body);
  }

  return parsed.data[0].embedding;
}

async function generateEmbedding(text) {
  const providers = {
    openai: {
      enabled: Boolean(process.env.OPENAI_API_KEY),
      fn: () => generateOpenAIEmbedding(text),
    },
    minimax: {
      enabled:
        Boolean(getMiniMaxEmbeddingKey()) &&
        !isMiniMaxCodingPlanKey(getMiniMaxEmbeddingKey()),
      fn: () => generateMiniMaxEmbedding(text),
    },
    jina: {
      enabled: Boolean(process.env.JINA_API_KEY),
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
    throw new Error("未配置可用的 Embedding Provider");
  }

  throw new Error(`所有 Embedding Provider 都失败了: ${failures.join(" | ")}`);
}

// ============================================================
// 收集所有 markdown 文件
// ============================================================

function collectFiles(dirPath) {
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".md")) {
        files.push(full);
      }
    }
  }

  walk(dirPath);
  return files;
}

// ============================================================
// 批量插入
// ============================================================

async function insertBatch(items) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/knowledge_items`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(items),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Insert failed: ${res.status} ${err}`);
  }
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  console.log(`📂 扫描目录: ${dir}`);
  const files = collectFiles(dir);
  const embeddingEnabled = isEmbeddingsEnabled();
  console.log(`📄 找到 ${files.length} 个 markdown 文件`);
  console.log(`👤 目标用户: ${USER_ID}`);
  console.log(`🧠 Embedding: ${embeddingEnabled ? "启用（与在线 Feed 同一检索文本）" : "关闭"}`);
  console.log("");

  const items = [];
  let skipped = 0;
  let embeddedCount = 0;

  for (const file of files) {
    try {
      const raw = readFileSync(file, "utf-8");
      const { meta, body } = parseFrontmatter(raw);

      const title = meta.title || basename(file, ".md");
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      const type = meta.type === "podcast" ? "article" : "article";
      const domain = classifyDomain(tags, title);
      const date = meta.date || new Date().toISOString().slice(0, 10);

      // 摘要：取正文前 500 字符
      const summary = body
        .replace(/!\[.*?\]\(.*?\)/g, "") // 去掉图片
        .replace(/\[([^\]]+)\]\(.*?\)/g, "$1") // 链接只保留文字
        .replace(/[#*_`>]/g, "") // 去掉 markdown 标记
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

      if (!summary || summary.length < 20) {
        skipped++;
        continue;
      }

      const rawContent = body.slice(0, 8000);
      const item = {
        user_id: USER_ID,
        type,
        title,
        summary,
        tags: tags.slice(0, 5),
        domain,
        source_type: "text",
        raw_content: rawContent,
        created_at: `${date}T00:00:00Z`,
      };

      if (embeddingEnabled) {
        try {
          const retrievalText = buildKnowledgeSearchText({
            title,
            summary,
            tags: item.tags,
            rawContent,
          });
          const embedding = await generateEmbedding(retrievalText);
          if (Array.isArray(embedding) && embedding.length > 0) {
            item.embedding = JSON.stringify(embedding);
            embeddedCount++;
          }
        } catch (err) {
          console.warn(`⚠️ embedding 跳过 ${basename(file)}: ${err.message}`);
        }
      }

      items.push(item);
    } catch (err) {
      console.error(`⚠️ 跳过 ${basename(file)}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`✅ 准备导入 ${items.length} 条（跳过 ${skipped} 条）`);
  console.log(`🔎 已生成 embeddings: ${embeddedCount}/${items.length}`);
  console.log("");

  // 分批插入
  let imported = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await insertBatch(batch);
      imported += batch.length;
      console.log(`  📥 ${imported}/${items.length}`);
    } catch (err) {
      console.error(`  ❌ 批次 ${i}-${i + batch.length} 失败: ${err.message}`);
    }
  }

  console.log("");
  console.log(`🎉 导入完成: ${imported} 条知识入库`);
}

main().catch(console.error);

#!/usr/bin/env node
/**
 * 批量重处理知识库：
 * 1. 对已有 connections 进行关系分类（supports/contradicts/extends/different_angle）
 * 2. 对每个领域触发编译综述
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MINIMAX_KEY = process.env.MINIMAX_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SERVICE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const TEST_USER_ID = process.env.TEST_USER_ID;

// ── MiniMax API 调用 ─────────────────────────────────────────

async function callMiniMax(systemPrompt, userPrompt) {
  const res = await fetch("https://api.minimaxi.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${MINIMAX_KEY}`,
    },
    body: JSON.stringify({
      model: "MiniMax-M2.7-highspeed",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function cleanJson(text) {
  let cleaned = text.trim();
  // Remove <think>...</think> blocks (MiniMax reasoning output)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Remove markdown code blocks
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Extract JSON array or object if surrounded by other text
  const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (match) cleaned = match[1];
  return cleaned;
}

// ── Step 1: 关系分类 ─────────────────────────────────────────

async function reclassifyConnections() {
  console.log("\n═══ Step 1: 关系分类 ═══");

  // 获取所有 similarity 类型的 connections
  const { data: connections, error } = await supabase
    .from("knowledge_connections")
    .select("id, from_id, to_id, connection_type, reason")
    .eq("user_id", TEST_USER_ID)
    .eq("connection_type", "similarity");

  if (error) {
    console.error("Failed to fetch connections:", error.message);
    return;
  }

  console.log(`Found ${connections.length} similarity connections to reclassify`);

  if (connections.length === 0) return;

  // 获取相关 items 的信息
  const itemIds = [...new Set(connections.flatMap(c => [c.from_id, c.to_id]))];
  const { data: items } = await supabase
    .from("knowledge_items")
    .select("id, title, summary")
    .in("id", itemIds);

  const itemMap = new Map(items.map(i => [i.id, i]));

  // 分批处理（每批 5 个）
  const batchSize = 5;
  let classified = 0;
  let failed = 0;

  for (let i = 0; i < connections.length; i += batchSize) {
    const batch = connections.slice(i, i + batchSize);

    const pairsDesc = batch.map((c, idx) => {
      const from = itemMap.get(c.from_id);
      const to = itemMap.get(c.to_id);
      return `[${idx}] 「${from?.title ?? "?"}」(${from?.summary?.slice(0, 100) ?? "?"}) ↔ 「${to?.title ?? "?"}」(${to?.summary?.slice(0, 100) ?? "?"})`;
    }).join("\n");

    try {
      const text = await callMiniMax(
        `你是知识关系分析引擎。判断每对知识之间的关系类型。
类型必须是以下之一：
- supports: 互相支持/印证
- contradicts: 观点矛盾
- extends: 一方扩展/深化另一方
- different_angle: 从不同视角讨论同一话题
只返回 JSON 数组，不要包含 markdown 代码块。`,
        `判断以下 ${batch.length} 对知识的关系：\n${pairsDesc}\n\n返回格式：[{"idx":0,"type":"supports","reason":"一句话"},...]`
      );

      const results = JSON.parse(cleanJson(text));

      for (const r of results) {
        const conn = batch[r.idx];
        if (!conn) continue;

        const validTypes = ["supports", "contradicts", "extends", "different_angle"];
        const type = validTypes.includes(r.type) ? r.type : "extends";

        await supabase
          .from("knowledge_connections")
          .update({
            connection_type: type,
            reason: r.reason || conn.reason,
          })
          .eq("id", conn.id);

        classified++;
      }

      console.log(`  Batch ${Math.floor(i / batchSize) + 1}: classified ${results.length} connections`);
    } catch (err) {
      console.error(`  Batch ${Math.floor(i / batchSize) + 1} failed:`, err.message);
      failed += batch.length;
    }

    // Rate limit: 等待 2 秒
    if (i + batchSize < connections.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nClassified: ${classified}, Failed: ${failed}, Total: ${connections.length}`);
}

// ── Step 2: 领域综述编译 ─────────────────────────────────────

async function compileDomainSummaries() {
  console.log("\n═══ Step 2: 领域综述编译 ═══");

  // 获取各领域的知识数量
  const { data: items } = await supabase
    .from("knowledge_items")
    .select("domain")
    .eq("user_id", TEST_USER_ID);

  const domainCounts = {};
  for (const item of items) {
    domainCounts[item.domain] = (domainCounts[item.domain] || 0) + 1;
  }

  console.log("Domain distribution:", domainCounts);

  for (const [domain, count] of Object.entries(domainCounts)) {
    if (count < 5) {
      console.log(`  ${domain}: ${count} items (< 5, skipping)`);
      continue;
    }

    console.log(`  ${domain}: ${count} items → compiling...`);

    // 获取该领域的所有知识
    const { data: domainItems } = await supabase
      .from("knowledge_items")
      .select("id, title, summary, tags, created_at")
      .eq("user_id", TEST_USER_ID)
      .eq("domain", domain)
      .order("created_at", { ascending: true });

    // 获取关联
    const { data: connections } = await supabase
      .from("knowledge_connections")
      .select("from_id, to_id, connection_type, reason")
      .eq("user_id", TEST_USER_ID);

    const sourceIds = domainItems.map(i => i.id);

    const itemsText = domainItems.slice(0, 50).map((item, idx) =>
      `[${idx + 1}] 「${item.title}」(${item.created_at?.slice(0, 10)})\n摘要: ${item.summary}\n标签: ${(item.tags || []).join(", ")}`
    ).join("\n\n");

    const relevantConns = (connections || [])
      .filter(c => sourceIds.includes(c.from_id) || sourceIds.includes(c.to_id))
      .slice(0, 20);

    const connText = relevantConns.length > 0
      ? relevantConns.map(c => `${c.connection_type}: ${c.reason || "无描述"}`).join("\n")
      : "无已知关联";

    try {
      const compiledContent = await callMiniMax(
        `你是知识编译引擎。基于用户在某个领域积累的所有知识条目，编写一篇结构化的领域综述。
要求：
- 用 Markdown 格式
- 包含：领域概览、核心观点汇总、观点之间的关联与矛盾、知识缺口与建议
- 引用具体条目（用编号如[1][2]）
- 客观呈现不同观点，标注矛盾之处
- 最后给出"下一步建议"：用户在这个领域还应该了解什么`,
        `领域: ${domain}\n共 ${domainItems.length} 篇知识条目（展示前 50 篇）：\n\n${itemsText}\n\n已知关联：\n${connText}\n\n请编写该领域的综述。`
      );

      // Upsert summary
      const { data: existing } = await supabase
        .from("knowledge_summaries")
        .select("id, version")
        .eq("user_id", TEST_USER_ID)
        .eq("domain", domain)
        .is("topic", null)
        .single();

      if (existing) {
        await supabase
          .from("knowledge_summaries")
          .update({
            compiled_content: compiledContent,
            source_ids: sourceIds,
            version: (existing.version || 0) + 1,
            last_compiled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        console.log(`    Updated v${(existing.version || 0) + 1}`);
      } else {
        await supabase
          .from("knowledge_summaries")
          .insert({
            user_id: TEST_USER_ID,
            domain,
            topic: null,
            compiled_content: compiledContent,
            source_ids: sourceIds,
            version: 1,
          });
        console.log(`    Created v1`);
      }
    } catch (err) {
      console.error(`    Failed to compile ${domain}:`, err.message);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ── Step 3: 统计报告 ─────────────────────────────────────────

async function generateReport() {
  console.log("\n═══ Step 3: 知识库分析报告 ═══");

  const { data: items } = await supabase
    .from("knowledge_items")
    .select("domain, type, tags, created_at")
    .eq("user_id", TEST_USER_ID);

  const { data: connections } = await supabase
    .from("knowledge_connections")
    .select("connection_type")
    .eq("user_id", TEST_USER_ID);

  const { data: summaries } = await supabase
    .from("knowledge_summaries")
    .select("domain, version, source_ids, last_compiled_at")
    .eq("user_id", TEST_USER_ID);

  // Domain distribution
  const domains = {};
  const allTags = {};
  for (const item of items) {
    domains[item.domain] = (domains[item.domain] || 0) + 1;
    for (const tag of (item.tags || [])) {
      allTags[tag] = (allTags[tag] || 0) + 1;
    }
  }

  // Connection types
  const connTypes = {};
  for (const c of connections) {
    connTypes[c.connection_type] = (connTypes[c.connection_type] || 0) + 1;
  }

  // Top tags
  const topTags = Object.entries(allTags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log("\n📊 知识库统计:");
  console.log(`  总条目: ${items.length}`);
  console.log(`  领域分布:`, domains);
  console.log(`  关联类型:`, connTypes);
  console.log(`  综述数量: ${summaries.length}`);
  console.log(`  Top 20 标签:`, topTags.map(([tag, count]) => `${tag}(${count})`).join(", "));

  // Identify gaps
  console.log("\n📋 领域覆盖分析:");
  const targetDomains = ["投资", "Agent Building", "健康", "一人公司", "跨领域"];
  for (const d of targetDomains) {
    const count = domains[d] || 0;
    const status = count >= 50 ? "充实" : count >= 20 ? "基础" : count >= 5 ? "薄弱" : "极度缺乏";
    console.log(`  ${d}: ${count} 条 → ${status}`);
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log("🧠 Cognitive Flywheel 知识库批量重处理");
  console.log(`  User: ${TEST_USER_ID}`);
  console.log(`  Supabase: ${SUPABASE_URL}`);

  await reclassifyConnections();
  await compileDomainSummaries();
  await generateReport();

  console.log("\n✅ 批量处理完成");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

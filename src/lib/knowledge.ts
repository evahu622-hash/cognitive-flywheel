import { generateText } from "ai";
import { getModel } from "./models";
import { cleanAIResponse } from "./utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// ============================================================
// 知识层核心逻辑
// 关系分类 / 跨域闪念 / 编译触发 / 领域综述 / 知识健康检查
// ============================================================

type AppSupabase = SupabaseClient<Database>;

// ── 关系类型 ──────────────────────────────────────────────────

export const RELATIONSHIP_TYPES = [
  "supports",
  "contradicts",
  "extends",
  "different_angle",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface RelationshipResult {
  targetId: string;
  targetTitle: string;
  type: RelationshipType;
  reason: string;
}

// ── Phase 5+: 关系分类 ────────────────────────────────────────

export async function classifyRelationships(
  newItem: { title: string; summary: string; domain: string },
  similarItems: { id: string; title: string; summary: string }[]
): Promise<RelationshipResult[]> {
  if (similarItems.length === 0) return [];

  const model = getModel("light");
  const itemsDesc = similarItems
    .map((s, i) => `[${i + 1}] ID:${s.id} 「${s.title}」: ${s.summary.slice(0, 200)}`)
    .join("\n");

  const { text } = await generateText({
    model,
    system: `你是知识关系分析引擎。判断一篇新内容与已有知识的关系。
关系类型必须是以下之一：
- supports: 新内容明确支持/印证已有观点（要有具体的观点对应关系）
- contradicts: 新内容与已有观点存在实质性矛盾（不仅是表述不同）
- extends: 新内容扩展/深化已有知识（在已有基础上增加了新维度）
- different_angle: 新内容确实从不同视角讨论同一话题（需要双方都有实质内容）

重要：如果新内容或已有知识信息不足（如只有标题没有实质内容摘要），不要强行分类该条目，直接从返回数组中省略。只对有充分证据的关系进行分类。
只返回合法 JSON 数组，不要包含 markdown 代码块。`,
    prompt: `新内容：「${newItem.title}」: ${newItem.summary.slice(0, 300)}

已有知识：
${itemsDesc}

返回格式：[{"id":"目标ID","type":"关系类型","reason":"一句话解释"}]`,
  });

  try {
    const cleaned = cleanAIResponse(text);
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (r: { id?: string; type?: string }) =>
          r.id &&
          r.type &&
          RELATIONSHIP_TYPES.includes(r.type as RelationshipType)
      )
      .map((r: { id: string; type: string; reason?: string }) => {
        const target = similarItems.find((s) => s.id === r.id);
        return {
          targetId: r.id,
          targetTitle: target?.title ?? "",
          type: r.type as RelationshipType,
          reason: r.reason ?? "",
        };
      });
  } catch {
    return [];
  }
}

// ── Phase 6: 跨域闪念 ────────────────────────────────────────

export interface SparkResult {
  spark: string;
  sourceDomain: string;
  isGeneral: boolean;
}

export async function generateConnectionSpark(
  newItem: { title: string; summary: string; domain: string },
  knowledgeBase: { title: string; summary: string; domain: string }[]
): Promise<SparkResult | null> {
  // 用 light 模型控制成本：跨域闪念每次 feed 都触发
  const model = getModel("light");

  // 跨域知识：取不同领域的 items
  const crossDomainItems = knowledgeBase.filter(
    (k) => k.domain !== newItem.domain
  );
  const isGeneral = crossDomainItems.length < 3;

  const contextDesc = isGeneral
    ? "使用你的通用知识"
    : crossDomainItems
        .slice(0, 5)
        .map((k) => `[${k.domain}] 「${k.title}」: ${k.summary.slice(0, 150)}`)
        .join("\n");

  const { text } = await generateText({
    model,
    system: `你是跨域连接引擎。找到一个出人意料但有启发性的跨领域类比。
要求：
- 类比必须来自与输入内容完全不同的领域
- 必须给出具体的结构映射：说明原文中的什么机制/原理与类比领域中的什么机制/原理对应
- 不要停留在"XX和YY都很重要"的抽象层面，要有可操作的启发
- 一段话，不超过100字
只返回 JSON，不要包含 markdown 代码块。`,
    prompt: `新内容 [${newItem.domain}]：「${newItem.title}」— ${newItem.summary.slice(0, 300)}

${isGeneral ? "用户知识库还较少，请基于通用知识生成类比。" : `用户知识库中的跨域内容：\n${contextDesc}`}

返回格式：{"spark":"类比内容","sourceDomain":"类比来源领域"}`,
  });

  try {
    const cleaned = cleanAIResponse(text);
    const parsed = JSON.parse(cleaned);
    return {
      spark: parsed.spark ?? "",
      sourceDomain: parsed.sourceDomain ?? "",
      isGeneral,
    };
  } catch {
    return null;
  }
}

// ── Phase 7: 编译触发检查 ─────────────────────────────────────

const COMPILE_THRESHOLD = 5;
// 已有综述时，只在条目数增长超过此比例才重新编译（避免每次 feed 都触发）
const RECOMPILE_GROWTH_RATIO = 0.2; // 20%
const RECOMPILE_MIN_DELTA = 3; // 或至少新增 3 条

export async function checkCompileTrigger(
  supabase: AppSupabase,
  userId: string,
  domain: string
): Promise<{ shouldCompile: boolean; isUpdate: boolean; itemCount: number }> {
  const { count } = await supabase
    .from("knowledge_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("domain", domain);

  const itemCount = count ?? 0;
  if (itemCount < COMPILE_THRESHOLD) {
    return { shouldCompile: false, isUpdate: false, itemCount };
  }

  const { data: existing } = await supabase
    .from("knowledge_summaries")
    .select("id, version, source_ids")
    .eq("user_id", userId)
    .eq("domain", domain)
    .is("topic", null)
    .single();

  if (!existing) {
    // 首次编译
    return { shouldCompile: true, isUpdate: false, itemCount };
  }

  // 已有综述：只有增量足够大时才重编译
  const previousCount = existing.source_ids?.length ?? 0;
  const delta = itemCount - previousCount;
  if (delta <= 0) {
    return { shouldCompile: false, isUpdate: true, itemCount };
  }

  const growthRatio = previousCount > 0 ? delta / previousCount : 1;
  const shouldRecompile =
    delta >= RECOMPILE_MIN_DELTA || growthRatio >= RECOMPILE_GROWTH_RATIO;

  return { shouldCompile: shouldRecompile, isUpdate: true, itemCount };
}

// ── 领域综述编译 ──────────────────────────────────────────────

export async function compileDomainSummary(
  supabase: AppSupabase,
  userId: string,
  domain: string
): Promise<{ compiled_content: string; source_ids: string[]; version: number }> {
  const { data: items } = await supabase
    .from("knowledge_items")
    .select("id, title, summary, tags, created_at")
    .eq("user_id", userId)
    .eq("domain", domain)
    .order("created_at", { ascending: true });

  if (!items || items.length === 0) {
    throw new Error(`No knowledge items found for domain: ${domain}`);
  }

  const { data: connections } = await supabase
    .from("knowledge_connections")
    .select("from_id, to_id, connection_type, reason")
    .eq("user_id", userId);

  const model = getModel("heavy");
  const sourceIds = items.map((i) => i.id);

  const itemsText = items
    .map(
      (i, idx) =>
        `[${idx + 1}] 「${i.title}」(${i.created_at.slice(0, 10)})\n摘要: ${i.summary}\n标签: ${i.tags.join(", ")}`
    )
    .join("\n\n");

  const connectionsText =
    connections && connections.length > 0
      ? connections
          .filter((c) => sourceIds.includes(c.from_id) || sourceIds.includes(c.to_id))
          .slice(0, 20)
          .map((c) => `${c.from_id.slice(0, 8)}→${c.to_id.slice(0, 8)}: ${c.connection_type} (${c.reason ?? ""})`)
          .join("\n")
      : "无已知关联";

  const { text } = await generateText({
    model,
    system: `你是知识编译引擎。基于用户在某个领域积累的所有知识条目，编写一篇结构化的领域综述。
要求：
- 用 Markdown 格式
- 包含：领域概览、核心观点汇总、观点之间的关联与矛盾、知识缺口与建议
- 引用具体条目（用编号如[1][2]）
- 客观呈现不同观点，标注矛盾之处
- 最后给出"下一步建议"：用户在这个领域还应该了解什么`,
    prompt: `领域: ${domain}
共 ${items.length} 篇知识条目：

${itemsText}

已知关联：
${connectionsText}

请编写该领域的综述。`,
  });

  // 查找已有综述
  const { data: existing } = await supabase
    .from("knowledge_summaries")
    .select("id, version")
    .eq("user_id", userId)
    .eq("domain", domain)
    .is("topic", null)
    .single();

  const newVersion = existing ? (existing.version ?? 0) + 1 : 1;

  if (existing) {
    await supabase
      .from("knowledge_summaries")
      .update({
        compiled_content: text,
        source_ids: sourceIds,
        last_compiled_at: new Date().toISOString(),
        version: newVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("knowledge_summaries").insert({
      user_id: userId,
      domain,
      topic: null,
      compiled_content: text,
      source_ids: sourceIds,
      version: newVersion,
    });
  }

  return { compiled_content: text, source_ids: sourceIds, version: newVersion };
}

// ── 知识健康检查 ──────────────────────────────────────────────

export interface LintReport {
  contradictions: {
    itemA: { id: string; title: string };
    itemB: { id: string; title: string };
    reason: string;
  }[];
  orphans: { id: string; title: string; domain: string }[];
  staleItems: { id: string; title: string; daysSinceUpdate: number }[];
  blindSpots: string[];
  totalItems: number;
}

// Lint 最多加载 500 条知识用于分析，避免 OOM
const LINT_MAX_ITEMS = 500;

export async function runKnowledgeLint(
  supabase: AppSupabase,
  userId: string
): Promise<LintReport> {
  // 获取知识条目（上限 LINT_MAX_ITEMS，按时间倒序取最新的）
  const { data: items } = await supabase
    .from("knowledge_items")
    .select("id, title, summary, domain, tags, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LINT_MAX_ITEMS);

  if (!items || items.length < 5) {
    return {
      contradictions: [],
      orphans: [],
      staleItems: [],
      blindSpots: [],
      totalItems: items?.length ?? 0,
    };
  }

  // 获取所有连接
  const { data: connections } = await supabase
    .from("knowledge_connections")
    .select("from_id, to_id, connection_type, reason")
    .eq("user_id", userId);

  // 1. 矛盾检测：找 connection_type = 'contradicts'
  const contradictions = (connections ?? [])
    .filter((c) => c.connection_type === "contradicts")
    .map((c) => {
      const itemA = items.find((i) => i.id === c.from_id);
      const itemB = items.find((i) => i.id === c.to_id);
      return {
        itemA: { id: c.from_id, title: itemA?.title ?? "未知" },
        itemB: { id: c.to_id, title: itemB?.title ?? "未知" },
        reason: c.reason ?? "存在矛盾关系",
      };
    });

  // 2. 孤岛检测：没有任何连接的 items
  const connectedIds = new Set<string>();
  for (const c of connections ?? []) {
    connectedIds.add(c.from_id);
    connectedIds.add(c.to_id);
  }
  const orphans = items
    .filter((i) => !connectedIds.has(i.id))
    .slice(0, 10)
    .map((i) => ({ id: i.id, title: i.title, domain: i.domain }));

  // 3. 陈旧检测：超过 30 天未更新
  const now = Date.now();
  const staleItems = items
    .filter((i) => {
      const updatedAt = new Date(i.updated_at ?? i.created_at).getTime();
      return now - updatedAt > 30 * 24 * 60 * 60 * 1000;
    })
    .slice(0, 10)
    .map((i) => ({
      id: i.id,
      title: i.title,
      daysSinceUpdate: Math.floor(
        (now - new Date(i.updated_at ?? i.created_at).getTime()) /
          (24 * 60 * 60 * 1000)
      ),
    }));

  // 4. 盲区检测：用 LLM 分析领域覆盖
  const domainCounts: Record<string, number> = {};
  for (const i of items) {
    domainCounts[i.domain] = (domainCounts[i.domain] ?? 0) + 1;
  }
  const allTags = [...new Set(items.flatMap((i) => i.tags))];

  let blindSpots: string[] = [];
  try {
    const model = getModel("light");
    const { text } = await generateText({
      model,
      system: `你是认知教练，帮助用户发现知识盲区。
基于用户的知识分布，指出 2-4 个可能的知识盲区或薄弱环节。
只返回 JSON 数组，每项是一句话描述。不要包含 markdown 代码块。`,
      prompt: `用户知识分布：
领域: ${JSON.stringify(domainCounts)}
标签覆盖: ${allTags.slice(0, 30).join(", ")}
总条目: ${items.length}

返回格式：["盲区1","盲区2","盲区3"]`,
    });
    const cleaned = cleanAIResponse(text);
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) blindSpots = parsed;
  } catch {
    blindSpots = [];
  }

  return {
    contradictions,
    orphans,
    staleItems,
    blindSpots,
    totalItems: items.length,
  };
}

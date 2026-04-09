import {
  KNOWLEDGE_DOMAINS,
  recordEvalResult,
  toJson,
  type EvalTraceEntryPoint,
} from "./evals";
import type { Database, Json } from "./database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const FAILURE_OPTIONS = [
  "feed.extraction_failed",
  "feed.summary_unfaithful",
  "feed.domain_wrong",
  "feed.duplicate_memory",
  "feed.relationship_wrong",
  "feed.spark_irrelevant",
  "retrieval.missed_relevant_memory",
  "retrieval.noisy_topk",
  "think.invalid_schema",
  "think.too_generic",
  "think.not_grounded",
  "think.not_actionable",
  "roundtable.low_diversity",
  "coach.blindspot_generic",
  "crossdomain.surface_analogy",
  "mirror.historical_inaccuracy",
  "compile.unfaithful_summary",
  "compile.missing_sources",
  "compile.incoherent",
  "lint.false_contradiction",
  "lint.missed_issue",
  "flywheel.should_not_save",
  "flywheel.unusable_saved_memory",
  "guardrail.fabricated_fact",
  "guardrail.overconfident_claim",
] as const;

type AppSupabase = SupabaseClient<Database>;

interface EvalContext {
  entryPoint: EvalTraceEntryPoint;
  mode?: string | null;
  requestPayload?: unknown;
  responsePayload?: unknown;
  metadata?: unknown;
}

interface NormalizedEvalContext {
  entryPoint: EvalTraceEntryPoint;
  mode?: string | null;
  requestPayload?: Json;
  responsePayload?: Json;
  metadata?: Json;
}

interface CodeEvaluatorResult {
  evaluatorName: string;
  passFail: boolean;
  score?: number | null;
  reason: string;
  metadata?: Json;
}

interface RunCodeEvaluatorsInput extends EvalContext {
  supabase: AppSupabase;
  userId: string;
  traceId: string | null;
  runId?: string | null;
}

function asRecord(value: Json | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function asArray(value: Json | undefined) {
  return Array.isArray(value) ? value : [];
}

function asString(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

function getNestedRecord(
  source: Record<string, Json> | null,
  key: string
): Record<string, Json> | null {
  return asRecord(source?.[key]);
}

function getNestedArray(
  source: Record<string, Json> | null,
  key: string
) {
  return asArray(source?.[key]);
}

function getFeedResult(responsePayload: Json | undefined) {
  return getNestedRecord(asRecord(responsePayload), "result");
}

function evaluateFeedSchema(context: NormalizedEvalContext): CodeEvaluatorResult {
  const result = getFeedResult(context.responsePayload);
  const hasTitle = asString(result?.title).trim().length > 0;
  const hasDomain = asString(result?.domain).trim().length > 0;
  const hasTags = getNestedArray(result, "tags").length > 0;
  const hasKeyPoints = getNestedArray(result, "keyPoints").length > 0;

  const passFail = hasTitle && hasDomain && hasTags && hasKeyPoints;

  return {
    evaluatorName: "feed_schema_valid",
    passFail,
    score: passFail ? 1 : 0,
    reason: passFail
      ? "Feed 结果结构完整"
      : "缺少 title/domain/tags/keyPoints 中的至少一项",
  };
}

function evaluateFeedNonEmpty(context: NormalizedEvalContext): CodeEvaluatorResult {
  const metadata = asRecord(context.metadata);
  const contentLength = Number(metadata?.contentLength ?? 0);
  const passFail = Number.isFinite(contentLength) && contentLength >= 50;

  return {
    evaluatorName: "feed_non_empty_content",
    passFail,
    score: contentLength,
    reason: passFail
      ? `抽取内容长度 ${contentLength}`
      : `抽取内容过短: ${contentLength}`,
    metadata: { contentLength },
  };
}

function evaluateFeedDomain(context: NormalizedEvalContext): CodeEvaluatorResult {
  const result = getFeedResult(context.responsePayload);
  const domain = asString(result?.domain).trim();
  const passFail = KNOWLEDGE_DOMAINS.includes(
    domain as (typeof KNOWLEDGE_DOMAINS)[number]
  );

  return {
    evaluatorName: "feed_domain_enum_valid",
    passFail,
    score: passFail ? 1 : 0,
    reason: passFail ? `领域合法: ${domain}` : `未知领域: ${domain || "空"}`,
    metadata: { domain },
  };
}

function evaluateThinkSchema(context: NormalizedEvalContext): CodeEvaluatorResult {
  const result = getNestedRecord(asRecord(context.responsePayload), "result");
  const insights = getNestedArray(result, "insights");
  let passFail = false;
  let reason = "未知模式";

  switch (context.mode) {
    case "roundtable":
      passFail = getNestedArray(result, "experts").length >= 3 && insights.length > 0;
      reason = passFail ? "Roundtable 结构有效" : "Roundtable 缺少 experts 或 insights";
      break;
    case "coach":
      passFail =
        getNestedArray(result, "strengths").length > 0 &&
        getNestedArray(result, "blindSpots").length > 0 &&
        getNestedArray(result, "learningPath").length > 0 &&
        insights.length > 0;
      reason = passFail ? "Coach 结构有效" : "Coach 缺少 strengths/blindSpots/learningPath/insights";
      break;
    case "crossdomain":
      passFail = getNestedArray(result, "connections").length >= 3 && insights.length > 0;
      reason = passFail ? "Crossdomain 结构有效" : "Crossdomain 缺少 connections 或 insights";
      break;
    case "mirror":
      passFail = getNestedArray(result, "figures").length >= 3 && insights.length > 0;
      reason = passFail ? "Mirror 结构有效" : "Mirror 缺少 figures 或 insights";
      break;
  }

  return {
    evaluatorName: "think_schema_valid",
    passFail,
    score: passFail ? 1 : 0,
    reason,
  };
}

function evaluateThinkRequiredFields(
  context: NormalizedEvalContext
): CodeEvaluatorResult {
  const result = getNestedRecord(asRecord(context.responsePayload), "result");
  const insights = getNestedArray(result, "insights");
  const insightStrings = insights.filter((item) => typeof item === "string");
  const passFail = insightStrings.length === insights.length && insightStrings.length > 0;

  return {
    evaluatorName: "think_required_fields_present",
    passFail,
    score: insightStrings.length,
    reason: passFail ? "insights 字段有效" : "insights 字段为空或包含非字符串元素",
  };
}

function evaluateThinkMinimumDepth(
  context: NormalizedEvalContext
): CodeEvaluatorResult {
  const result = getNestedRecord(asRecord(context.responsePayload), "result");
  let lengths: number[] = [];

  switch (context.mode) {
    case "roundtable":
      lengths = getNestedArray(result, "experts").map((expert) =>
        asString(asRecord(expert)?.content).length
      );
      break;
    case "coach":
      lengths = getNestedArray(result, "learningPath").map((item) =>
        asString(asRecord(item)?.task).length
      );
      break;
    case "crossdomain":
      lengths = getNestedArray(result, "connections").map((item) =>
        asString(asRecord(item)?.content).length
      );
      break;
    case "mirror":
      lengths = getNestedArray(result, "figures").map((item) =>
        asString(asRecord(item)?.story).length
      );
      break;
  }

  const averageLength =
    lengths.length > 0
      ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length)
      : 0;
  const passFail = lengths.length > 0 && averageLength >= 40;

  return {
    evaluatorName: "think_minimum_depth",
    passFail,
    score: averageLength,
    reason: passFail
      ? `平均内容长度 ${averageLength}`
      : `平均内容长度不足: ${averageLength}`,
    metadata: { averageLength, sampleCount: lengths.length },
  };
}

function evaluateInsightSave(
  context: NormalizedEvalContext
): CodeEvaluatorResult {
  const response = asRecord(context.responsePayload);
  const action = asString(response?.action);

  if (action === "skip") {
    return {
      evaluatorName: "insight_memory_write_success",
      passFail: true,
      score: 1,
      reason: "用户选择跳过保存，视为成功记录反馈",
    };
  }

  const savedItemIds = asArray(response?.savedItemIds);
  const passFail = savedItemIds.length > 0;

  return {
    evaluatorName: "insight_memory_write_success",
    passFail,
    score: savedItemIds.length,
    reason: passFail
      ? `已保存 ${savedItemIds.length} 条洞察`
      : "保存操作未产生 knowledge item",
    metadata: { savedItemCount: savedItemIds.length },
  };
}

function evaluateInsightActionLogged(
  context: NormalizedEvalContext
): CodeEvaluatorResult {
  const response = asRecord(context.responsePayload);
  const action = asString(response?.action);
  const passFail = action === "save" || action === "skip";

  return {
    evaluatorName: "insight_save_action_logged",
    passFail,
    score: passFail ? 1 : 0,
    reason: passFail ? `已记录动作: ${action}` : "未记录 save/skip 动作",
    metadata: { action },
  };
}

// ── Feed: 关系分类验证 ─────────────────────────────────────────

const VALID_RELATIONSHIP_TYPES = ["supports", "contradicts", "extends", "different_angle"];

function evaluateFeedRelationshipType(context: NormalizedEvalContext): CodeEvaluatorResult {
  const result = getFeedResult(context.responsePayload);
  const relationships = getNestedArray(result, "relationships");

  if (relationships.length === 0) {
    return {
      evaluatorName: "feed_relationship_type_valid",
      passFail: true,
      score: 1,
      reason: "无关系分类（可能无相似知识），跳过检查",
    };
  }

  const allValid = relationships.every((r) => {
    const rec = asRecord(r);
    return rec && VALID_RELATIONSHIP_TYPES.includes(asString(rec.type));
  });

  return {
    evaluatorName: "feed_relationship_type_valid",
    passFail: allValid,
    score: allValid ? 1 : 0,
    reason: allValid
      ? `${relationships.length} 条关系类型均合法`
      : "存在无效的关系类型",
    metadata: { relationshipCount: relationships.length },
  };
}

// ── Feed: Spark 存在性验证 ─────────────────────────────────────

function evaluateFeedSparkPresent(context: NormalizedEvalContext): CodeEvaluatorResult {
  const result = getFeedResult(context.responsePayload);
  const spark = asRecord(result?.spark);
  const sparkText = asString(spark?.spark);
  const hasSpark = sparkText.length > 0;

  return {
    evaluatorName: "feed_spark_present",
    passFail: hasSpark,
    score: hasSpark ? 1 : 0,
    reason: hasSpark
      ? `Spark 已生成 (${sparkText.length} 字)`
      : "未生成 Connection Spark",
    metadata: { sparkLength: sparkText.length },
  };
}

// ── Feed: Spark 跨域验证 ──────────────────────────────────────

function evaluateFeedSparkCrossDomain(context: NormalizedEvalContext): CodeEvaluatorResult {
  const result = getFeedResult(context.responsePayload);
  const spark = asRecord(result?.spark);
  const sourceDomain = asString(spark?.sourceDomain);
  const itemDomain = asString(result?.domain);

  if (!sourceDomain) {
    return {
      evaluatorName: "feed_spark_cross_domain",
      passFail: true,
      score: 1,
      reason: "无 Spark 或无来源领域，跳过检查",
    };
  }

  const isCrossDomain = sourceDomain !== itemDomain;
  return {
    evaluatorName: "feed_spark_cross_domain",
    passFail: isCrossDomain,
    score: isCrossDomain ? 1 : 0,
    reason: isCrossDomain
      ? `Spark 来自不同领域: ${sourceDomain} vs ${itemDomain}`
      : `Spark 来自相同领域: ${sourceDomain}`,
    metadata: { sourceDomain, itemDomain },
  };
}

// ── Compile: 来源引用验证 ──────────────────────────────────────

function evaluateCompileSourcesReferenced(context: NormalizedEvalContext): CodeEvaluatorResult {
  const response = asRecord(context.responsePayload);
  const sourceIds = asArray(response?.source_ids);
  const content = asString(response?.compiled_content);
  const hasContent = content.length > 100;
  const hasSources = sourceIds.length > 0;
  const passFail = hasContent && hasSources;

  return {
    evaluatorName: "compile_sources_referenced",
    passFail,
    score: sourceIds.length,
    reason: passFail
      ? `综述引用了 ${sourceIds.length} 篇来源，内容长度 ${content.length}`
      : `综述内容不足或缺少来源引用`,
    metadata: { sourceCount: sourceIds.length, contentLength: content.length },
  };
}

// ── Compile: 版本递增验证 ──────────────────────────────────────

function evaluateCompileVersionIncrement(context: NormalizedEvalContext): CodeEvaluatorResult {
  const response = asRecord(context.responsePayload);
  const version = Number(response?.version ?? 0);
  const passFail = version >= 1;

  return {
    evaluatorName: "compile_version_increment",
    passFail,
    score: version,
    reason: passFail ? `版本号: v${version}` : "版本号无效",
    metadata: { version },
  };
}

// ── Lint: 全部检查执行验证 ─────────────────────────────────────

function evaluateLintAllChecksRan(context: NormalizedEvalContext): CodeEvaluatorResult {
  const response = asRecord(context.responsePayload);
  const hasContradictions = response?.contradictions !== undefined;
  const hasOrphans = response?.orphans !== undefined;
  const hasStale = response?.staleItems !== undefined;
  const hasBlindSpots = response?.blindSpots !== undefined;
  const passFail = hasContradictions && hasOrphans && hasStale && hasBlindSpots;

  return {
    evaluatorName: "lint_all_checks_ran",
    passFail,
    score: passFail ? 1 : 0,
    reason: passFail
      ? "全部 4 项检查已执行"
      : `缺少检查项: ${[!hasContradictions && "contradictions", !hasOrphans && "orphans", !hasStale && "staleItems", !hasBlindSpots && "blindSpots"].filter(Boolean).join(", ")}`,
  };
}

// ── Lint: 报告结构验证 ────────────────────────────────────────

function evaluateLintReportStructured(context: NormalizedEvalContext): CodeEvaluatorResult {
  const response = asRecord(context.responsePayload);
  const contradictions = asArray(response?.contradictions);
  const orphans = asArray(response?.orphans);
  const staleItems = asArray(response?.staleItems);
  const blindSpots = asArray(response?.blindSpots);
  const totalItems = Number(response?.totalItems ?? 0);

  const passFail = totalItems > 0;

  return {
    evaluatorName: "lint_report_structured",
    passFail,
    score: contradictions.length + orphans.length + staleItems.length + blindSpots.length,
    reason: passFail
      ? `报告包含 ${contradictions.length} 矛盾, ${orphans.length} 孤岛, ${staleItems.length} 过时, ${blindSpots.length} 盲区`
      : "报告无数据或 totalItems 为 0",
    metadata: {
      contradictions: contradictions.length,
      orphans: orphans.length,
      staleItems: staleItems.length,
      blindSpots: blindSpots.length,
      totalItems,
    },
  };
}

function getCodeEvaluators(context: NormalizedEvalContext) {
  switch (context.entryPoint) {
    case "feed":
      return [
        evaluateFeedSchema,
        evaluateFeedNonEmpty,
        evaluateFeedDomain,
        evaluateFeedRelationshipType,
        evaluateFeedSparkPresent,
        evaluateFeedSparkCrossDomain,
      ];
    case "think":
      return [
        evaluateThinkSchema,
        evaluateThinkRequiredFields,
        evaluateThinkMinimumDepth,
      ];
    case "save_insight":
      return [evaluateInsightActionLogged, evaluateInsightSave];
    case "compile":
      return [evaluateCompileSourcesReferenced, evaluateCompileVersionIncrement];
    case "lint":
      return [evaluateLintAllChecksRan, evaluateLintReportStructured];
    default:
      return [];
  }
}

export async function runCodeEvaluatorsForTrace({
  supabase,
  userId,
  traceId,
  runId,
  ...context
}: RunCodeEvaluatorsInput) {
  const normalizedContext: NormalizedEvalContext = {
    ...context,
    requestPayload: toJson(context.requestPayload ?? {}),
    responsePayload: toJson(context.responsePayload ?? {}),
    metadata: toJson(context.metadata ?? {}),
  };
  const evaluators = getCodeEvaluators(normalizedContext);

  for (const evaluator of evaluators) {
    const result = evaluator(normalizedContext);
    await recordEvalResult({
      supabase,
      userId,
      traceId,
      evaluatorName: result.evaluatorName,
      evaluatorType: "code",
      score: result.score ?? null,
      passFail: result.passFail,
      reason: result.reason,
      metadata: result.metadata ?? {},
      runId: runId ?? "auto",
    });
  }
}

import { LLM_JUDGE_OPTIONS } from "./eval-options";
import type { Database, Json } from "./database.types";

type EvalTraceRow = Database["public"]["Tables"]["eval_traces"]["Row"];
type EvalResultRow = Database["public"]["Tables"]["eval_results"]["Row"];
type EvalFeedbackRow = Database["public"]["Tables"]["eval_feedback"]["Row"];
type EvalLabelRow = Database["public"]["Tables"]["eval_labels"]["Row"];
type EvalTraceEntryPoint = EvalTraceRow["entry_point"];

const ENTRY_POINT_ORDER: EvalTraceEntryPoint[] = [
  "feed",
  "think",
  "save_insight",
  "compile",
  "lint",
  "memory",
];

const CORE_EVALUATORS: Record<EvalTraceEntryPoint, string[]> = {
  feed: ["feed_schema_valid", "feed_non_empty_content", "feed_domain_enum_valid"],
  think: [
    "think_schema_valid",
    "think_required_fields_present",
    "think_minimum_depth",
  ],
  save_insight: ["insight_save_action_logged", "insight_memory_write_success"],
  compile: ["compile_sources_referenced", "compile_version_increment"],
  lint: ["lint_all_checks_ran", "lint_report_structured"],
  memory: [],
};

const VALUE_ENTRY_POINTS = new Set<EvalTraceEntryPoint>([
  "feed",
  "think",
  "save_insight",
]);

const TREND_WINDOW_DAYS = 7;
const REGRESSION_WINDOW_DAYS = 7;

const SAVE_WORTHY_EVALUATORS = new Set([
  "think_save_worthy",
  "feed_store_worthy",
]);

const JUDGE_ELIGIBLE_ENTRY_POINTS = new Set<EvalTraceEntryPoint>(
  LLM_JUDGE_OPTIONS.flatMap((item) => item.entryPoints) as EvalTraceEntryPoint[]
);

function asRecord(value: Json | null): Record<string, Json> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function asArray(value: Json | null): Json[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: Json | null) {
  return asArray(value).filter(
    (item): item is string => typeof item === "string" && item.length > 0
  );
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1)
  );
  return sorted[index];
}

function toUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKeyFromDate(date: Date) {
  return toUtcDay(date).toISOString().slice(0, 10);
}

function dayKeyFromTimestamp(value: string) {
  return dayKeyFromDate(new Date(value));
}

function rate(count: number, total: number) {
  return total > 0 ? count / total : 0;
}

function nullableRate(count: number, total: number) {
  return total > 0 ? count / total : null;
}

function buildDayKeys(anchor: Date, days: number, offsetDays = 0) {
  const keys: string[] = [];
  const start = toUtcDay(anchor);
  start.setUTCDate(start.getUTCDate() - offsetDays);

  for (let index = days - 1; index >= 0; index -= 1) {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() - index);
    keys.push(dayKeyFromDate(current));
  }

  return keys;
}

function entryPointRank(entryPoint: string) {
  const index = ENTRY_POINT_ORDER.indexOf(entryPoint as EvalTraceEntryPoint);
  return index === -1 ? ENTRY_POINT_ORDER.length : index;
}

function getTraceContextIds(trace: EvalTraceRow) {
  const metadata = asRecord(trace.metadata);
  return asStringArray(metadata?.contextIds ?? null);
}

function getLatestResultsByTrace(results: EvalResultRow[]) {
  const traceMap = new Map<string, Map<string, EvalResultRow>>();

  const sorted = [...results].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );

  for (const result of sorted) {
    const traceResults =
      traceMap.get(result.trace_id) ?? new Map<string, EvalResultRow>();
    traceResults.set(result.evaluator_name, result);
    traceMap.set(result.trace_id, traceResults);
  }

  return traceMap;
}

function getFeedbackMaps(feedback: EvalFeedbackRow[]) {
  const byTraceId = new Map<string, EvalFeedbackRow[]>();
  const bySessionId = new Map<string, EvalFeedbackRow[]>();

  for (const item of feedback) {
    if (item.trace_id) {
      const bucket = byTraceId.get(item.trace_id) ?? [];
      bucket.push(item);
      byTraceId.set(item.trace_id, bucket);
    }

    if (item.think_session_id) {
      const bucket = bySessionId.get(item.think_session_id) ?? [];
      bucket.push(item);
      bySessionId.set(item.think_session_id, bucket);
    }
  }

  return { byTraceId, bySessionId };
}

function getTraceFeedback(
  trace: EvalTraceRow,
  feedbackByTraceId: Map<string, EvalFeedbackRow[]>,
  feedbackBySessionId: Map<string, EvalFeedbackRow[]>
) {
  const direct = feedbackByTraceId.get(trace.id) ?? [];
  const session = trace.session_id
    ? feedbackBySessionId.get(trace.session_id) ?? []
    : [];
  return [...direct, ...session];
}

function getSavedItemIds(feedback: EvalFeedbackRow[]) {
  const savedIds = new Set<string>();

  for (const item of feedback) {
    if (item.feedback_type !== "save") continue;
    const metadata = asRecord(item.metadata);
    const ids = asStringArray(metadata?.savedItemIds ?? null);
    for (const id of ids) {
      savedIds.add(id);
    }
  }

  return savedIds;
}

function buildEntryPointStat({
  traces,
  entryPoint,
  latestResults,
  labeledTraceIds,
  hvftrTraceIds,
}: {
  traces: EvalTraceRow[];
  entryPoint: EvalTraceEntryPoint;
  latestResults: Map<string, Map<string, EvalResultRow>>;
  labeledTraceIds: Set<string>;
  hvftrTraceIds: Set<string>;
}) {
  const entryTraces = traces.filter((trace) => trace.entry_point === entryPoint);
  const entrySuccessTraces = entryTraces.filter(
    (trace) => trace.trace_status === "success"
  );
  const entryLatency = entrySuccessTraces
    .map((trace) => trace.latency_ms)
    .filter((value): value is number => typeof value === "number" && value >= 0);
  const qualityCount = entrySuccessTraces.filter((trace) => {
    return (
      passesCoreEvaluators(trace, latestResults) &&
      !hasCriticalGuardrailFailure(trace.id, latestResults)
    );
  }).length;
  const autoEvalCount = entrySuccessTraces.filter((trace) => {
    return (latestResults.get(trace.id)?.size ?? 0) > 0;
  }).length;
  const judgeEligibleTraces = entrySuccessTraces.filter((trace) =>
    JUDGE_ELIGIBLE_ENTRY_POINTS.has(trace.entry_point)
  );
  const judgeCount = judgeEligibleTraces.filter((trace) => {
    const traceResults = latestResults.get(trace.id);
    return (
      traceResults &&
      [...traceResults.values()].some((result) => result.evaluator_type === "llm_judge")
    );
  }).length;
  const guardrailFailCount = entrySuccessTraces.filter((trace) =>
    hasCriticalGuardrailFailure(trace.id, latestResults)
  ).length;
  const reviewedCount = entryTraces.filter((trace) => labeledTraceIds.has(trace.id)).length;
  const pendingReviewCount = entryTraces.length - reviewedCount;
  const hvftrCount = entrySuccessTraces.filter((trace) => hvftrTraceIds.has(trace.id)).length;

  return {
    entryPoint,
    total: entryTraces.length,
    successCount: entrySuccessTraces.length,
    errorCount: entryTraces.filter((trace) => trace.trace_status === "error").length,
    successRate: rate(entrySuccessTraces.length, entryTraces.length),
    qualityCount,
    qualityRate: rate(qualityCount, entrySuccessTraces.length),
    autoEvalCount,
    autoEvalCoverageRate: rate(autoEvalCount, entrySuccessTraces.length),
    judgeEligibleCount: judgeEligibleTraces.length,
    judgeCount,
    judgeCoverageRate: nullableRate(judgeCount, judgeEligibleTraces.length),
    guardrailFailCount,
    guardrailFailRate: rate(guardrailFailCount, entrySuccessTraces.length),
    reviewedCount,
    reviewCoverageRate: rate(reviewedCount, entryTraces.length),
    pendingReviewCount,
    hvftrCount,
    avgLatencyMs:
      entryLatency.length > 0
        ? Math.round(entryLatency.reduce((sum, value) => sum + value, 0) / entryLatency.length)
        : null,
    p95LatencyMs: percentile(entryLatency, 0.95),
  };
}

function passesCoreEvaluators(
  trace: EvalTraceRow,
  latestResults: Map<string, Map<string, EvalResultRow>>
) {
  const required = CORE_EVALUATORS[trace.entry_point] ?? [];
  if (required.length === 0) return true;

  const traceResults = latestResults.get(trace.id);
  if (!traceResults) return false;

  return required.every((evaluatorName) => {
    const result = traceResults.get(evaluatorName);
    return result?.pass_fail === true;
  });
}

function hasCriticalGuardrailFailure(
  traceId: string,
  latestResults: Map<string, Map<string, EvalResultRow>>
) {
  const traceResults = latestResults.get(traceId);
  if (!traceResults) return false;

  return [...traceResults.values()].some(
    (result) =>
      result.evaluator_name.startsWith("guardrail_") &&
      result.pass_fail === false
  );
}

function hasAnyFailedEvaluator(
  traceId: string,
  latestResults: Map<string, Map<string, EvalResultRow>>
) {
  const traceResults = latestResults.get(traceId);
  if (!traceResults) return false;

  return [...traceResults.values()].some((result) => result.pass_fail === false);
}

function isAcceptedTrace(
  trace: EvalTraceRow,
  latestResults: Map<string, Map<string, EvalResultRow>>,
  feedbackByTraceId: Map<string, EvalFeedbackRow[]>,
  feedbackBySessionId: Map<string, EvalFeedbackRow[]>
) {
  const traceFeedback = getTraceFeedback(
    trace,
    feedbackByTraceId,
    feedbackBySessionId
  );

  if (traceFeedback.some((item) => item.feedback_type === "save")) {
    return true;
  }

  const traceResults = latestResults.get(trace.id);
  if (
    traceResults &&
    [...traceResults.values()].some(
      (result) =>
        SAVE_WORTHY_EVALUATORS.has(result.evaluator_name) &&
        result.pass_fail === true
    )
  ) {
    return true;
  }

  const response = asRecord(trace.response_payload);
  return response?.action === "save";
}

export function buildEvalMetrics({
  traces,
  results,
  feedback,
  labels,
}: {
  traces: EvalTraceRow[];
  results: EvalResultRow[];
  feedback: EvalFeedbackRow[];
  labels: EvalLabelRow[];
}) {
  const totalTraces = traces.length;
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const successTraces = traces.filter((trace) => trace.trace_status === "success");
  const latencyValues = successTraces
    .map((trace) => trace.latency_ms)
    .filter((value): value is number => typeof value === "number" && value >= 0);

  const latestResults = getLatestResultsByTrace(results);
  const { byTraceId, bySessionId } = getFeedbackMaps(feedback);
  const savedItemIds = getSavedItemIds(feedback);
  const labeledTraceIds = new Set(labels.map((label) => label.trace_id));
  const anchorDate =
    traces.length > 0
      ? new Date(
          Math.max(
            ...traces.map((trace) => new Date(trace.started_at).getTime())
          )
        )
      : new Date();

  const valueSuccessTraces = successTraces.filter((trace) =>
    VALUE_ENTRY_POINTS.has(trace.entry_point)
  );
  const hvftrTraces = valueSuccessTraces.filter((trace) => {
    return (
      passesCoreEvaluators(trace, latestResults) &&
      !hasCriticalGuardrailFailure(trace.id, latestResults) &&
      isAcceptedTrace(trace, latestResults, byTraceId, bySessionId)
    );
  });
  const hvftrTraceIds = new Set(hvftrTraces.map((trace) => trace.id));

  const tracesWithAnyResults = successTraces.filter((trace) => {
    return (latestResults.get(trace.id)?.size ?? 0) > 0;
  });
  const judgeEligibleSuccessTraces = successTraces.filter((trace) =>
    JUDGE_ELIGIBLE_ENTRY_POINTS.has(trace.entry_point)
  );
  const tracesWithJudgeResults = judgeEligibleSuccessTraces.filter((trace) => {
    const traceResults = latestResults.get(trace.id);
    return (
      traceResults &&
      [...traceResults.values()].some((result) => result.evaluator_type === "llm_judge")
    );
  });

  const reusedThinkTraces = successTraces.filter((trace) => {
    if (trace.entry_point !== "think") return false;
    return getTraceContextIds(trace).some((id) => savedItemIds.has(id));
  });

  const reusedSavedInsightIds = new Set(
    reusedThinkTraces.flatMap((trace) =>
      getTraceContextIds(trace).filter((id) => savedItemIds.has(id))
    )
  );

  const entryPointStats = ENTRY_POINT_ORDER.map((entryPoint) =>
    buildEntryPointStat({
      traces,
      entryPoint,
      latestResults,
      labeledTraceIds,
      hvftrTraceIds,
    })
  ).filter((item) => item.total > 0);

  const pipeline = entryPointStats.map((item) => ({
    entryPoint: item.entryPoint,
    total: item.total,
    successCount: item.successCount,
    errorCount: item.errorCount,
    successRate: item.successRate,
    avgLatencyMs: item.avgLatencyMs,
  }));

  const evaluators = [...results]
    .reduce((acc, result) => {
      const bucket = acc.get(result.evaluator_name) ?? {
        name: result.evaluator_name,
        type: result.evaluator_type,
        total: 0,
        passCount: 0,
        failCount: 0,
      };

      bucket.total += 1;
      if (result.pass_fail === true) bucket.passCount += 1;
      if (result.pass_fail === false) bucket.failCount += 1;

      acc.set(result.evaluator_name, bucket);
      return acc;
    }, new Map<string, {
      name: string;
      type: string;
      total: number;
      passCount: number;
      failCount: number;
    }>())
    .values();

  const evaluatorStats = [...evaluators]
    .map((item) => ({
      name: item.name,
      type: item.type,
      total: item.total,
      passRate: item.total > 0 ? item.passCount / item.total : 0,
      failCount: item.failCount,
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.name.localeCompare(b.name);
    });

  const labelHotspots = [...labels]
    .filter((label) => label.failure_code)
    .reduce((acc, label) => {
      const code = label.failure_code!;
      const trace = traceById.get(label.trace_id);
      const bucket = acc.get(code) ?? {
        code,
        count: 0,
        entryPoints: new Set<string>(),
        latestCreatedAt: label.created_at,
      };

      bucket.count += 1;
      if (trace) bucket.entryPoints.add(trace.entry_point);
      if (label.created_at > bucket.latestCreatedAt) {
        bucket.latestCreatedAt = label.created_at;
      }
      acc.set(code, bucket);
      return acc;
    }, new Map<string, {
      code: string;
      count: number;
      entryPoints: Set<string>;
      latestCreatedAt: string;
    }>());

  const failureCodes = [...labelHotspots.values()]
    .map((bucket) => ({
      code: bucket.code,
      count: bucket.count,
      entryPoints: [...bucket.entryPoints].sort(
        (a, b) => entryPointRank(a) - entryPointRank(b)
      ),
      latestCreatedAt: bucket.latestCreatedAt,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const automatedHotspots = [...successTraces]
    .reduce((acc, trace) => {
      const traceResults = latestResults.get(trace.id);
      if (!traceResults) return acc;

      for (const result of traceResults.values()) {
        if (result.pass_fail !== false) continue;

        const key = result.evaluator_name;
        const bucket = acc.get(key) ?? {
          evaluatorName: key,
          evaluatorType: result.evaluator_type,
          count: 0,
          entryPoints: new Set<string>(),
          exampleTraceIds: [] as string[],
        };

        bucket.count += 1;
        bucket.entryPoints.add(trace.entry_point);
        if (bucket.exampleTraceIds.length < 3) {
          bucket.exampleTraceIds.push(trace.id);
        }
        acc.set(key, bucket);
      }

      return acc;
    }, new Map<string, {
      evaluatorName: string;
      evaluatorType: string;
      count: number;
      entryPoints: Set<string>;
      exampleTraceIds: string[];
    }>());

  const evaluatorHotspots = [...automatedHotspots.values()]
    .map((bucket) => ({
      evaluatorName: bucket.evaluatorName,
      evaluatorType: bucket.evaluatorType,
      count: bucket.count,
      entryPoints: [...bucket.entryPoints].sort(
        (a, b) => entryPointRank(a) - entryPointRank(b)
      ),
      exampleTraceIds: bucket.exampleTraceIds,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const evaluatorMatrix = [...successTraces]
    .reduce((acc, trace) => {
      const traceResults = latestResults.get(trace.id);
      if (!traceResults) return acc;

      for (const result of traceResults.values()) {
        const key = `${trace.entry_point}:${result.evaluator_name}`;
        const bucket = acc.get(key) ?? {
          entryPoint: trace.entry_point,
          evaluatorName: result.evaluator_name,
          evaluatorType: result.evaluator_type,
          total: 0,
          passCount: 0,
          failCount: 0,
        };

        bucket.total += 1;
        if (result.pass_fail === true) bucket.passCount += 1;
        if (result.pass_fail === false) bucket.failCount += 1;
        acc.set(key, bucket);
      }

      return acc;
    }, new Map<string, {
      entryPoint: string;
      evaluatorName: string;
      evaluatorType: string;
      total: number;
      passCount: number;
      failCount: number;
    }>());

  const evaluatorByEntryPoint = [...evaluatorMatrix.values()]
    .map((bucket) => ({
      entryPoint: bucket.entryPoint,
      evaluatorName: bucket.evaluatorName,
      evaluatorType: bucket.evaluatorType,
      total: bucket.total,
      passRate: bucket.total > 0 ? bucket.passCount / bucket.total : 0,
      failCount: bucket.failCount,
    }))
    .sort((a, b) => {
      if (entryPointRank(a.entryPoint) !== entryPointRank(b.entryPoint)) {
        return entryPointRank(a.entryPoint) - entryPointRank(b.entryPoint);
      }
      if (a.passRate !== b.passRate) return a.passRate - b.passRate;
      if (b.total !== a.total) return b.total - a.total;
      return a.evaluatorName.localeCompare(b.evaluatorName);
    });

  const unreviewedByEntryPoint = entryPointStats.map((item) => ({
    entryPoint: item.entryPoint,
    pendingReviewCount: item.pendingReviewCount,
  }));

  const highPriorityPendingCount = successTraces.filter((trace) => {
    return (
      !labeledTraceIds.has(trace.id) &&
      (hasCriticalGuardrailFailure(trace.id, latestResults) ||
        hasAnyFailedEvaluator(trace.id, latestResults))
    );
  }).length;

  const recentDayKeys = buildDayKeys(anchorDate, TREND_WINDOW_DAYS);
  const recentDayKeySet = new Set(recentDayKeys);
  const trends = recentDayKeys.map((dayKey) => {
    const bucketTraces = traces.filter((trace) => dayKeyFromTimestamp(trace.started_at) === dayKey);
    const bucketSuccessTraces = bucketTraces.filter(
      (trace) => trace.trace_status === "success"
    );
    const bucketValueSuccessTraces = bucketSuccessTraces.filter((trace) =>
      VALUE_ENTRY_POINTS.has(trace.entry_point)
    );
    const bucketJudgeEligibleTraces = bucketSuccessTraces.filter((trace) =>
      JUDGE_ELIGIBLE_ENTRY_POINTS.has(trace.entry_point)
    );
    const bucketJudgeCount = bucketJudgeEligibleTraces.filter((trace) => {
      const traceResults = latestResults.get(trace.id);
      return (
        traceResults &&
        [...traceResults.values()].some((result) => result.evaluator_type === "llm_judge")
      );
    }).length;
    const bucketAutoEvalCount = bucketSuccessTraces.filter((trace) => {
      return (latestResults.get(trace.id)?.size ?? 0) > 0;
    }).length;
    const bucketReviewedCount = bucketTraces.filter((trace) =>
      labeledTraceIds.has(trace.id)
    ).length;
    const bucketGuardrailFailCount = bucketSuccessTraces.filter((trace) =>
      hasCriticalGuardrailFailure(trace.id, latestResults)
    ).length;
    const bucketHvftrCount = bucketValueSuccessTraces.filter((trace) =>
      hvftrTraceIds.has(trace.id)
    ).length;

    return {
      day: dayKey,
      totalTraces: bucketTraces.length,
      successRate: rate(bucketSuccessTraces.length, bucketTraces.length),
      hvftrRate: rate(bucketHvftrCount, bucketValueSuccessTraces.length),
      autoEvalCoverageRate: rate(bucketAutoEvalCount, bucketSuccessTraces.length),
      judgeCoverageRate: nullableRate(
        bucketJudgeCount,
        bucketJudgeEligibleTraces.length
      ),
      reviewCoverageRate: rate(bucketReviewedCount, bucketTraces.length),
      guardrailFailRate: rate(bucketGuardrailFailCount, bucketSuccessTraces.length),
    };
  });

  const currentWindowTraces = traces.filter((trace) =>
    recentDayKeySet.has(dayKeyFromTimestamp(trace.started_at))
  );
  const previousDayKeys = buildDayKeys(
    anchorDate,
    REGRESSION_WINDOW_DAYS,
    REGRESSION_WINDOW_DAYS
  );
  const previousDayKeySet = new Set(previousDayKeys);
  const previousWindowTraces = traces.filter((trace) =>
    previousDayKeySet.has(dayKeyFromTimestamp(trace.started_at))
  );

  const regressionMetrics = [
    { key: "successRate", label: "Success Rate", higherIsBetter: true },
    { key: "qualityRate", label: "Quality Rate", higherIsBetter: true },
    { key: "autoEvalCoverageRate", label: "Auto Eval Coverage", higherIsBetter: true },
    { key: "judgeCoverageRate", label: "Judge Coverage", higherIsBetter: true },
    { key: "reviewCoverageRate", label: "Review Coverage", higherIsBetter: true },
    { key: "guardrailFailRate", label: "Guardrail Fail Rate", higherIsBetter: false },
  ] as const;

  const regressions = ENTRY_POINT_ORDER.flatMap((entryPoint) => {
    const current = buildEntryPointStat({
      traces: currentWindowTraces,
      entryPoint,
      latestResults,
      labeledTraceIds,
      hvftrTraceIds,
    });
    const previous = buildEntryPointStat({
      traces: previousWindowTraces,
      entryPoint,
      latestResults,
      labeledTraceIds,
      hvftrTraceIds,
    });
    const rows: Array<{
      entryPoint: EvalTraceEntryPoint;
      metric: (typeof regressionMetrics)[number]["key"];
      metricLabel: string;
      currentRate: number;
      previousRate: number;
      delta: number;
      regressionAmount: number;
      currentTotal: number;
      previousTotal: number;
    }> = [];

    for (const metric of regressionMetrics) {
      const currentRate = current[metric.key];
      const previousRate = previous[metric.key];
      if (typeof currentRate !== "number" || typeof previousRate !== "number") {
        continue;
      }

      const delta = currentRate - previousRate;
      const regressionAmount = metric.higherIsBetter ? previousRate - currentRate : delta;
      const currentTotal =
        metric.key === "judgeCoverageRate"
          ? current.judgeEligibleCount
          : metric.key === "successRate" || metric.key === "reviewCoverageRate"
            ? current.total
            : current.successCount;
      const previousTotal =
        metric.key === "judgeCoverageRate"
          ? previous.judgeEligibleCount
          : metric.key === "successRate" || metric.key === "reviewCoverageRate"
            ? previous.total
            : previous.successCount;

      if (currentTotal <= 0 || previousTotal <= 0 || regressionAmount <= 0) {
        continue;
      }

      rows.push({
        entryPoint,
        metric: metric.key,
        metricLabel: metric.label,
        currentRate,
        previousRate,
        delta,
        regressionAmount,
        currentTotal,
        previousTotal,
      });
    }

    return rows;
  })
    .sort((a, b) => b.regressionAmount - a.regressionAmount)
    .slice(0, 8);

  const funnel = [
    {
      id: "feed_success",
      label: "Feed 成功轮次",
      count: entryPointStats.find((item) => item.entryPoint === "feed")?.successCount ?? 0,
      rate:
        (entryPointStats.find((item) => item.entryPoint === "feed")?.successRate ??
          0),
    },
    {
      id: "think_success",
      label: "Think 成功轮次",
      count:
        entryPointStats.find((item) => item.entryPoint === "think")?.successCount ??
        0,
      rate:
        (entryPointStats.find((item) => item.entryPoint === "think")?.successRate ??
          0),
    },
    {
      id: "save_actions",
      label: "用户保存动作",
      count: feedback.filter((item) => item.feedback_type === "save").length,
      rate:
        successTraces.length > 0
          ? feedback.filter((item) => item.feedback_type === "save").length /
            successTraces.length
          : 0,
    },
    {
      id: "saved_insights",
      label: "回流洞察数",
      count: savedItemIds.size,
      rate:
        feedback.filter((item) => item.feedback_type === "save").length > 0
          ? savedItemIds.size /
            feedback.filter((item) => item.feedback_type === "save").length
          : 0,
    },
    {
      id: "reused_turns",
      label: "后续复用轮次",
      count: reusedThinkTraces.length,
      rate:
        successTraces.filter((trace) => trace.entry_point === "think").length > 0
          ? reusedThinkTraces.length /
            successTraces.filter((trace) => trace.entry_point === "think").length
          : 0,
    },
  ];

  return {
    summary: {
      totalTraces,
      successRate: totalTraces > 0 ? successTraces.length / totalTraces : 0,
      hvftrCount: hvftrTraces.length,
      hvftrRate:
        valueSuccessTraces.length > 0 ? hvftrTraces.length / valueSuccessTraces.length : 0,
      hvftrEligibleCount: valueSuccessTraces.length,
      p50LatencyMs: percentile(latencyValues, 0.5),
      p95LatencyMs: percentile(latencyValues, 0.95),
      labeledTraces: labeledTraceIds.size,
      pendingReviewCount: Math.max(totalTraces - labeledTraceIds.size, 0),
      reviewCoverageRate:
        totalTraces > 0 ? labeledTraceIds.size / totalTraces : 0,
    },
    feedback: {
      saveCount: feedback.filter((item) => item.feedback_type === "save").length,
      skipCount: feedback.filter((item) => item.feedback_type === "skip").length,
      saveRate:
        successTraces.length > 0
          ? feedback.filter((item) => item.feedback_type === "save").length /
            successTraces.length
          : 0,
      savedInsightCount: savedItemIds.size,
    },
    flywheel: {
      savedInsightCount: savedItemIds.size,
      reusedSavedInsightCount: reusedSavedInsightIds.size,
      reusedThinkTraceCount: reusedThinkTraces.length,
      reuseRate:
        savedItemIds.size > 0
          ? reusedSavedInsightIds.size / savedItemIds.size
          : 0,
      reuseTurnRate:
        successTraces.filter((trace) => trace.entry_point === "think").length > 0
          ? reusedThinkTraces.length /
            successTraces.filter((trace) => trace.entry_point === "think").length
          : 0,
    },
    overview: {
      autoEvalCoverageRate:
        successTraces.length > 0
          ? tracesWithAnyResults.length / successTraces.length
          : 0,
      judgeCoverageRate:
        judgeEligibleSuccessTraces.length > 0
          ? tracesWithJudgeResults.length / judgeEligibleSuccessTraces.length
          : 0,
      guardrailFailRate:
        successTraces.length > 0
          ? successTraces.filter((trace) =>
              hasCriticalGuardrailFailure(trace.id, latestResults)
            ).length / successTraces.length
          : 0,
      trends,
      funnel,
      entryPoints: entryPointStats,
    },
    diagnosis: {
      labelHotspots: failureCodes,
      automatedHotspots: evaluatorHotspots,
      evaluatorByEntryPoint,
      regressions,
      coverage: {
        tracesWithoutAutoEvalCount: successTraces.length - tracesWithAnyResults.length,
        tracesWithoutJudgeCount:
          judgeEligibleSuccessTraces.length - tracesWithJudgeResults.length,
        highPriorityPendingCount,
        unreviewedByEntryPoint,
      },
    },
    review: {
      pendingReviewCount: Math.max(totalTraces - labeledTraceIds.size, 0),
      highPriorityPendingCount,
      unreviewedByEntryPoint,
    },
    pipeline,
    evaluators: evaluatorStats,
    failureCodes: failureCodes.map(({ code, count }) => ({ code, count })),
  };
}

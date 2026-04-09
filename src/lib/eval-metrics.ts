import type { Database, Json } from "./database.types";

type EvalTraceRow = Database["public"]["Tables"]["eval_traces"]["Row"];
type EvalResultRow = Database["public"]["Tables"]["eval_results"]["Row"];
type EvalFeedbackRow = Database["public"]["Tables"]["eval_feedback"]["Row"];
type EvalLabelRow = Database["public"]["Tables"]["eval_labels"]["Row"];

const CORE_EVALUATORS: Record<string, string[]> = {
  feed: ["feed_schema_valid", "feed_non_empty_content", "feed_domain_enum_valid"],
  think: [
    "think_schema_valid",
    "think_required_fields_present",
    "think_minimum_depth",
  ],
  save_insight: ["insight_save_action_logged", "insight_memory_write_success"],
  memory: [],
};

const SAVE_WORTHY_EVALUATORS = new Set([
  "think_save_worthy",
  "feed_store_worthy",
]);

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
  const successTraces = traces.filter((trace) => trace.trace_status === "success");
  const latencyValues = successTraces
    .map((trace) => trace.latency_ms)
    .filter((value): value is number => typeof value === "number" && value >= 0);

  const latestResults = getLatestResultsByTrace(results);
  const { byTraceId, bySessionId } = getFeedbackMaps(feedback);
  const savedItemIds = getSavedItemIds(feedback);
  const labeledTraceIds = new Set(labels.map((label) => label.trace_id));
  const hvftrTraces = successTraces.filter((trace) => {
    return (
      passesCoreEvaluators(trace, latestResults) &&
      !hasCriticalGuardrailFailure(trace.id, latestResults) &&
      isAcceptedTrace(trace, latestResults, byTraceId, bySessionId)
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

  const pipeline = (["feed", "think", "save_insight", "memory"] as const)
    .map((entryPoint) => {
      const entryTraces = traces.filter((trace) => trace.entry_point === entryPoint);
      const entryLatency = entryTraces
        .map((trace) => trace.latency_ms)
        .filter(
          (value): value is number => typeof value === "number" && value >= 0
        );

      return {
        entryPoint,
        total: entryTraces.length,
        successCount: entryTraces.filter((trace) => trace.trace_status === "success")
          .length,
        errorCount: entryTraces.filter((trace) => trace.trace_status === "error")
          .length,
        successRate:
          entryTraces.length > 0
            ? entryTraces.filter((trace) => trace.trace_status === "success")
                .length / entryTraces.length
            : 0,
        avgLatencyMs:
          entryLatency.length > 0
            ? Math.round(
                entryLatency.reduce((sum, value) => sum + value, 0) /
                  entryLatency.length
              )
            : null,
      };
    })
    .filter((item) => item.total > 0);

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

  const failureCodes = [...labels]
    .filter((label) => label.failure_code)
    .reduce((acc, label) => {
      const code = label.failure_code!;
      acc.set(code, (acc.get(code) ?? 0) + 1);
      return acc;
    }, new Map<string, number>());

  return {
    summary: {
      totalTraces,
      successRate: totalTraces > 0 ? successTraces.length / totalTraces : 0,
      hvftrCount: hvftrTraces.length,
      hvftrRate: totalTraces > 0 ? hvftrTraces.length / totalTraces : 0,
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
    pipeline,
    evaluators: evaluatorStats,
    failureCodes: [...failureCodes.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

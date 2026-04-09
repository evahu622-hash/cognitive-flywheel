import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

export type EvalTraceEntryPoint =
  | "feed"
  | "memory"
  | "think"
  | "save_insight"
  | "compile"
  | "lint";

export type EvalTraceStatus = "running" | "success" | "error" | "partial";
export type EvalSpanStatus = "running" | "success" | "error" | "skipped";
export type EvalFeedbackType =
  | "save"
  | "skip"
  | "thumb_up"
  | "thumb_down"
  | "edit";

export const KNOWLEDGE_DOMAINS = [
  "投资",
  "Agent Building",
  "健康",
  "一人公司",
  "跨领域",
] as const;

export const PROMPT_VERSIONS = {
  feed: "feed-v1",
  think: "think-v1",
  saveInsight: "save-insight-v1",
  compile: "compile-v1",
  lint: "lint-v1",
} as const;

type AppSupabase = SupabaseClient<Database>;

interface CreateEvalTraceInput {
  supabase: AppSupabase;
  userId: string;
  entryPoint: EvalTraceEntryPoint;
  sourceType?: string | null;
  mode?: string | null;
  modelName?: string | null;
  promptVersion?: string | null;
  requestPayload?: unknown;
  metadata?: unknown;
}

interface UpdateEvalTraceInput {
  supabase: AppSupabase;
  traceId: string | null;
  status: EvalTraceStatus;
  responsePayload?: unknown;
  metadata?: unknown;
  errorMessage?: string | null;
  sessionId?: string | null;
  knowledgeItemId?: string | null;
  startedAtMs?: number;
}

interface RecordEvalFeedbackInput {
  supabase: AppSupabase;
  userId: string;
  feedbackType: EvalFeedbackType;
  traceId?: string | null;
  thinkSessionId?: string | null;
  knowledgeItemId?: string | null;
  feedbackText?: string | null;
  metadata?: unknown;
}

interface RecordEvalResultInput {
  supabase: AppSupabase;
  userId: string;
  traceId: string | null;
  evaluatorName: string;
  evaluatorType: "code" | "llm_judge" | "human";
  score?: number | null;
  passFail?: boolean | null;
  reason?: string | null;
  metadata?: unknown;
  runId?: string | null;
}

interface RunEvalSpanInput<T> {
  supabase: AppSupabase;
  userId: string;
  traceId: string | null;
  spanName: string;
  inputPayload?: unknown;
  metadata?: unknown;
  fn: () => Promise<T>;
  outputMapper?: (value: T) => unknown;
}

function truncateString(value: string, maxLength = 4000) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function toJson(value: unknown, maxStringLength = 4000): Json {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, currentValue) => {
        if (currentValue instanceof Error) {
          return {
            name: currentValue.name,
            message: currentValue.message,
            stack: currentValue.stack
              ? truncateString(currentValue.stack, maxStringLength)
              : null,
          };
        }

        if (typeof currentValue === "string") {
          return truncateString(currentValue, maxStringLength);
        }

        return currentValue;
      })
    ) as Json;
  } catch {
    return { value: String(value) };
  }
}

function logEvalWarning(message: string, error: unknown) {
  console.warn(`[eval] ${message}`, error);
}

export async function createEvalTrace({
  supabase,
  userId,
  entryPoint,
  sourceType,
  mode,
  modelName,
  promptVersion,
  requestPayload,
  metadata,
}: CreateEvalTraceInput): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("eval_traces")
      .insert({
        user_id: userId,
        entry_point: entryPoint,
        source_type: sourceType ?? null,
        mode: mode ?? null,
        model_name: modelName ?? null,
        prompt_version: promptVersion ?? null,
        request_payload: toJson(requestPayload ?? {}),
        metadata: toJson(metadata ?? {}),
      })
      .select("id")
      .single();

    if (error) {
      logEvalWarning("Failed to create trace", error);
      return null;
    }

    return data.id;
  } catch (error) {
    logEvalWarning("Failed to create trace", error);
    return null;
  }
}

export async function updateEvalTrace({
  supabase,
  traceId,
  status,
  responsePayload,
  metadata,
  errorMessage,
  sessionId,
  knowledgeItemId,
  startedAtMs,
}: UpdateEvalTraceInput) {
  if (!traceId) return;

  try {
    const endedAt = new Date().toISOString();
    const latencyMs =
      typeof startedAtMs === "number" ? Date.now() - startedAtMs : null;

    const { error } = await supabase
      .from("eval_traces")
      .update({
        trace_status: status,
        response_payload: toJson(responsePayload ?? {}),
        metadata: toJson(metadata ?? {}),
        error_message: errorMessage ?? null,
        session_id: sessionId ?? null,
        knowledge_item_id: knowledgeItemId ?? null,
        ended_at: endedAt,
        latency_ms: latencyMs,
      })
      .eq("id", traceId);

    if (error) {
      logEvalWarning("Failed to update trace", error);
    }
  } catch (error) {
    logEvalWarning("Failed to update trace", error);
  }
}

export async function recordEvalFeedback({
  supabase,
  userId,
  feedbackType,
  traceId,
  thinkSessionId,
  knowledgeItemId,
  feedbackText,
  metadata,
}: RecordEvalFeedbackInput) {
  try {
    const { error } = await supabase.from("eval_feedback").insert({
      user_id: userId,
      trace_id: traceId ?? null,
      think_session_id: thinkSessionId ?? null,
      knowledge_item_id: knowledgeItemId ?? null,
      feedback_type: feedbackType,
      feedback_text: feedbackText ?? null,
      metadata: toJson(metadata ?? {}),
    });

    if (error) {
      logEvalWarning("Failed to record feedback", error);
    }
  } catch (error) {
    logEvalWarning("Failed to record feedback", error);
  }
}

export async function recordEvalResult({
  supabase,
  userId,
  traceId,
  evaluatorName,
  evaluatorType,
  score,
  passFail,
  reason,
  metadata,
  runId,
}: RecordEvalResultInput) {
  if (!traceId) return;

  try {
    const { error } = await supabase.from("eval_results").insert({
      user_id: userId,
      trace_id: traceId,
      evaluator_name: evaluatorName,
      evaluator_type: evaluatorType,
      score: score ?? null,
      pass_fail: passFail ?? null,
      reason: reason ?? null,
      metadata: toJson(metadata ?? {}),
      run_id: runId ?? null,
    });

    if (error) {
      logEvalWarning("Failed to record eval result", error);
    }
  } catch (error) {
    logEvalWarning("Failed to record eval result", error);
  }
}

export async function runEvalSpan<T>({
  supabase,
  userId,
  traceId,
  spanName,
  inputPayload,
  metadata,
  fn,
  outputMapper,
}: RunEvalSpanInput<T>): Promise<T> {
  const startedAtMs = Date.now();
  let spanId: string | null = null;

  if (traceId) {
    try {
      const { data, error } = await supabase
        .from("eval_spans")
        .insert({
          trace_id: traceId,
          user_id: userId,
          span_name: spanName,
          input_payload: toJson(inputPayload ?? {}),
          metadata: toJson(metadata ?? {}),
        })
        .select("id")
        .single();

      if (error) {
        logEvalWarning("Failed to create span", error);
      } else {
        spanId = data.id;
      }
    } catch (error) {
      logEvalWarning("Failed to create span", error);
    }
  }

  try {
    const result = await fn();

    if (spanId) {
      const { error } = await supabase
        .from("eval_spans")
        .update({
          span_status: "success",
          output_payload: toJson(
            outputMapper ? outputMapper(result) : { ok: true }
          ),
          ended_at: new Date().toISOString(),
          latency_ms: Date.now() - startedAtMs,
        })
        .eq("id", spanId);

      if (error) {
        logEvalWarning("Failed to finalize span", error);
      }
    }

    return result;
  } catch (error) {
    if (spanId) {
      const { error: updateError } = await supabase
        .from("eval_spans")
        .update({
          span_status: "error",
          output_payload: toJson({ ok: false }),
          error_message:
            error instanceof Error ? error.message : String(error ?? "Unknown"),
          ended_at: new Date().toISOString(),
          latency_ms: Date.now() - startedAtMs,
        })
        .eq("id", spanId);

      if (updateError) {
        logEvalWarning("Failed to finalize failed span", updateError);
      }
    }

    throw error;
  }
}

export function buildKnowledgeContextText(
  items: Array<{
    title: string;
    summary: string;
    tags?: string[] | null;
    domain?: string | null;
  }>
) {
  return items
    .map((item, index) => {
      const domain = item.domain ? `领域: ${item.domain}` : "";
      const tags =
        item.tags && item.tags.length > 0 ? `标签: ${item.tags.join(" / ")}` : "";

      return [
        `# 记忆片段 ${index + 1}`,
        `标题: ${item.title}`,
        domain,
        tags,
        `摘要: ${item.summary}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export function inferInsightDomain(
  knowledgeContext: Array<{ domain?: string | null }>
) {
  const counts = new Map<string, number>();

  for (const item of knowledgeContext) {
    const domain = item.domain?.trim();
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? "跨领域";
}

export function buildInsightTitle(insight: string) {
  const clean = insight.replace(/\s+/g, " ").trim();
  if (!clean) return "未命名洞察";
  return clean.length > 28 ? `${clean.slice(0, 28)}...` : clean;
}

import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildEvalSetupRequiredPayload,
  isMissingEvalTableMessage,
} from "@/lib/eval-setup";

const VALID_ENTRY_POINTS = [
  "feed",
  "memory",
  "think",
  "save_insight",
  "compile",
  "lint",
] as const;
const VALID_TRACE_STATUSES = ["running", "success", "error", "partial"] as const;
const VALID_REVIEW_STATES = ["all", "reviewed", "unreviewed"] as const;

export async function GET(req: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const traceId = searchParams.get("traceId");
  const entryPoint = searchParams.get("entryPoint");
  const status = searchParams.get("status");
  const reviewState = searchParams.get("reviewState") ?? "all";
  const limit = Number(searchParams.get("limit") || 20);

  if (traceId) {
    const { data: trace, error: traceError } = await supabase
      .from("eval_traces")
      .select("*")
      .eq("id", traceId)
      .eq("user_id", user.id)
      .single();

    if (traceError) {
      if (isMissingEvalTableMessage(traceError.message)) {
        return Response.json(buildEvalSetupRequiredPayload(traceError.message), {
          status: 503,
        });
      }
      return Response.json({ error: traceError.message }, { status: 404 });
    }

    const [
      spansResponse,
      resultsResponse,
      feedbackResponse,
      labelsResponse,
    ] = await Promise.all([
      supabase
        .from("eval_spans")
        .select("*")
        .eq("trace_id", traceId)
        .order("started_at", { ascending: true }),
      supabase
        .from("eval_results")
        .select("*")
        .eq("trace_id", traceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("eval_feedback")
        .select("*")
        .or(`trace_id.eq.${traceId},think_session_id.eq.${trace.session_id ?? "00000000-0000-0000-0000-000000000000"}`)
        .order("created_at", { ascending: false }),
      supabase
        .from("eval_labels")
        .select("*")
        .eq("trace_id", traceId)
        .order("created_at", { ascending: false }),
    ]);

    return Response.json({
      trace,
      spans: spansResponse.data ?? [],
      results: resultsResponse.data ?? [],
      feedback: feedbackResponse.data ?? [],
      labels: labelsResponse.data ?? [],
    });
  }

  const requestedLimit = Number.isFinite(limit) ? limit : 20;
  const fetchLimit =
    VALID_REVIEW_STATES.includes(
      reviewState as (typeof VALID_REVIEW_STATES)[number]
    ) && reviewState !== "all"
      ? Math.min(requestedLimit * 5, 200)
      : requestedLimit;

  let query = supabase
    .from("eval_traces")
    .select("id, entry_point, trace_status, source_type, mode, model_name, started_at, ended_at, latency_ms, error_message, session_id, knowledge_item_id")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(fetchLimit);

  if (
    entryPoint &&
    VALID_ENTRY_POINTS.includes(
      entryPoint as (typeof VALID_ENTRY_POINTS)[number]
    )
  ) {
    const validEntryPoint = entryPoint as (typeof VALID_ENTRY_POINTS)[number];
    query = query.eq("entry_point", validEntryPoint);
  }

  if (
    status &&
    VALID_TRACE_STATUSES.includes(
      status as (typeof VALID_TRACE_STATUSES)[number]
    )
  ) {
    const validStatus = status as (typeof VALID_TRACE_STATUSES)[number];
    query = query.eq("trace_status", validStatus);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingEvalTableMessage(error.message)) {
      return Response.json(buildEvalSetupRequiredPayload(error.message), {
        status: 503,
      });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  const traces = data ?? [];
  const traceIds = traces.map((trace) => trace.id);
  const sessionIds = traces
    .map((trace) => trace.session_id)
    .filter((value): value is string => Boolean(value));

  const [labelsResponse, feedbackResponse] = await Promise.all([
    traceIds.length > 0
      ? supabase
          .from("eval_labels")
          .select("trace_id")
          .in("trace_id", traceIds)
      : Promise.resolve({ data: [], error: null }),
    traceIds.length > 0 || sessionIds.length > 0
      ? supabase
          .from("eval_feedback")
          .select("trace_id, think_session_id, feedback_type, created_at")
          .or(
            [
              traceIds.length > 0 ? `trace_id.in.(${traceIds.join(",")})` : null,
              sessionIds.length > 0
                ? `think_session_id.in.(${sessionIds.join(",")})`
                : null,
            ]
              .filter(Boolean)
              .join(",")
          )
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (labelsResponse.error || feedbackResponse.error) {
    const missingMessage =
      labelsResponse.error?.message ?? feedbackResponse.error?.message;
    if (isMissingEvalTableMessage(missingMessage)) {
      return Response.json(buildEvalSetupRequiredPayload(missingMessage), {
        status: 503,
      });
    }
    return Response.json(
      {
        error:
          labelsResponse.error?.message ?? feedbackResponse.error?.message ?? "加载评审信息失败",
      },
      { status: 500 }
    );
  }

  const labelCountByTraceId = (labelsResponse.data ?? []).reduce(
    (acc, label) => {
      acc.set(label.trace_id, (acc.get(label.trace_id) ?? 0) + 1);
      return acc;
    },
    new Map<string, number>()
  );

  const feedbackByKey = new Map<
    string,
    { feedback_type: string; created_at: string }[]
  >();

  for (const item of feedbackResponse.data ?? []) {
    if (item.trace_id) {
      const traceBucket = feedbackByKey.get(item.trace_id) ?? [];
      traceBucket.push({
        feedback_type: item.feedback_type,
        created_at: item.created_at,
      });
      feedbackByKey.set(item.trace_id, traceBucket);
    }

    if (item.think_session_id) {
      const sessionBucket = feedbackByKey.get(item.think_session_id) ?? [];
      sessionBucket.push({
        feedback_type: item.feedback_type,
        created_at: item.created_at,
      });
      feedbackByKey.set(item.think_session_id, sessionBucket);
    }
  }

  const enrichedTraces = traces.map((trace) => {
    const reviewCount = labelCountByTraceId.get(trace.id) ?? 0;
    const feedbackItems = [
      ...(feedbackByKey.get(trace.id) ?? []),
      ...(trace.session_id ? feedbackByKey.get(trace.session_id) ?? [] : []),
    ].sort((a, b) => b.created_at.localeCompare(a.created_at));

    return {
      ...trace,
      review_count: reviewCount,
      review_state: reviewCount > 0 ? "reviewed" : "unreviewed",
      latest_feedback_type: feedbackItems[0]?.feedback_type ?? null,
    };
  });

  const filteredTraces =
    reviewState === "reviewed"
      ? enrichedTraces.filter((trace) => trace.review_count > 0)
      : reviewState === "unreviewed"
        ? enrichedTraces.filter((trace) => trace.review_count === 0)
        : enrichedTraces;

  return Response.json({ traces: filteredTraces.slice(0, requestedLimit) });
}

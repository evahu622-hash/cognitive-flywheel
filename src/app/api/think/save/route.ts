import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildInsightTitle,
  createEvalTrace,
  inferInsightDomain,
  PROMPT_VERSIONS,
  recordEvalFeedback,
  runEvalSpan,
  updateEvalTrace,
} from "@/lib/evals";
import { runCodeEvaluatorsForTrace } from "@/lib/evaluators";

interface SaveInsightRequest {
  action: "save" | "skip";
  sessionId: string;
  traceId?: string | null;
  insights?: string[];
  note?: string;
}

export async function POST(req: Request) {
  const startedAtMs = Date.now();
  const body = (await req.json()) as SaveInsightRequest;

  if (!body.sessionId) {
    return Response.json({ error: "缺少 sessionId" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const traceId = await createEvalTrace({
    supabase,
    userId: user.id,
    entryPoint: "save_insight",
    sourceType: "text",
    promptVersion: PROMPT_VERSIONS.saveInsight,
    requestPayload: {
      action: body.action,
      sessionId: body.sessionId,
      originalTraceId: body.traceId ?? null,
      requestedInsightCount: body.insights?.length ?? null,
    },
  });

  try {
    const thinkSession = await runEvalSpan({
      supabase,
      userId: user.id,
      traceId,
      spanName: "load_think_session",
      inputPayload: {
        sessionId: body.sessionId,
      },
      fn: async () => {
        const { data, error } = await supabase
          .from("think_sessions")
          .select("id, mode, question, insights, knowledge_context")
          .eq("id", body.sessionId)
          .eq("user_id", user.id)
          .single();

        if (error) throw error;
        return data;
      },
      outputMapper: (value) => ({
        sessionId: value.id,
        insightCount: value.insights.length,
        knowledgeContextCount: value.knowledge_context.length,
      }),
    });

    const selectedInsights =
      body.insights?.filter((item) => item.trim().length > 0) ??
      thinkSession.insights;

    if (body.action === "skip") {
      await recordEvalFeedback({
        supabase,
        userId: user.id,
        feedbackType: "skip",
        traceId: body.traceId ?? null,
        thinkSessionId: thinkSession.id,
        feedbackText: body.note ?? null,
        metadata: {
          selectedInsightCount: selectedInsights.length,
        },
      });

      const resultPayload = {
        action: "skip",
        sessionId: thinkSession.id,
        savedItemIds: [],
      };

      await updateEvalTrace({
        supabase,
        traceId,
        status: "success",
        responsePayload: resultPayload,
        metadata: {
          originalTraceId: body.traceId ?? null,
        },
        sessionId: thinkSession.id,
        startedAtMs,
      });

      await runCodeEvaluatorsForTrace({
        supabase,
        userId: user.id,
        traceId,
        entryPoint: "save_insight",
        requestPayload: {
          action: body.action,
          sessionId: body.sessionId,
        },
        responsePayload: resultPayload,
      });

      return Response.json(resultPayload);
    }

    if (selectedInsights.length === 0) {
      return Response.json({ error: "没有可保存的洞察" }, { status: 400 });
    }

    const domain = inferInsightDomain(
      thinkSession.knowledge_context as Array<{ domain?: string | null }>
    );
    const tags = [thinkSession.mode, "回流洞察"];

    const savedItems = await runEvalSpan({
      supabase,
      userId: user.id,
      traceId,
      spanName: "persist_insights",
      inputPayload: {
        selectedInsightCount: selectedInsights.length,
        domain,
      },
      fn: async () => {
        const rows = selectedInsights.map((insight) => ({
          user_id: user.id,
          type: "insight" as const,
          title: buildInsightTitle(insight),
          summary: insight,
          tags,
          domain,
          source_type: "thought" as const,
          raw_content: `问题：${thinkSession.question}\n\n模式：${thinkSession.mode}\n\n洞察：${insight}`,
        }));

        const { data, error } = await supabase
          .from("knowledge_items")
          .insert(rows)
          .select("id, title");

        if (error) throw error;
        return data;
      },
      outputMapper: (value) => ({
        savedItemIds: value.map((item) => item.id),
      }),
    });

    const contextIds = (
      thinkSession.knowledge_context as Array<{ id?: string }>
    )
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));

    if (contextIds.length > 0) {
      await runEvalSpan({
        supabase,
        userId: user.id,
        traceId,
        spanName: "link_saved_insights",
        inputPayload: {
          savedItemCount: savedItems.length,
          contextCount: contextIds.length,
        },
        fn: async () => {
          const rows = savedItems.flatMap((item) =>
            contextIds.map((contextId) => ({
              user_id: user.id,
              from_id: item.id,
              to_id: contextId,
              connection_type: "derived_from",
              reason: `来自 think session ${thinkSession.id} 的上下文回流`,
            }))
          );

          const { error } = await supabase
            .from("knowledge_connections")
            .insert(rows);

          if (error) throw error;
          return rows;
        },
        outputMapper: (value) => ({
          connectionCount: value.length,
        }),
      });
    }

    await recordEvalFeedback({
      supabase,
      userId: user.id,
      feedbackType: "save",
      traceId: body.traceId ?? null,
      thinkSessionId: thinkSession.id,
      knowledgeItemId: savedItems[0]?.id ?? null,
      feedbackText: body.note ?? null,
      metadata: {
        savedItemIds: savedItems.map((item) => item.id),
        savedItemCount: savedItems.length,
      },
    });

    const resultPayload = {
      action: "save",
      sessionId: thinkSession.id,
      savedItemIds: savedItems.map((item) => item.id),
      savedItemTitles: savedItems.map((item) => item.title),
    };

    await updateEvalTrace({
      supabase,
      traceId,
      status: "success",
      responsePayload: resultPayload,
      metadata: {
        originalTraceId: body.traceId ?? null,
        savedItemCount: savedItems.length,
      },
      sessionId: thinkSession.id,
      knowledgeItemId: savedItems[0]?.id ?? null,
      startedAtMs,
    });

    await runCodeEvaluatorsForTrace({
      supabase,
      userId: user.id,
      traceId,
      entryPoint: "save_insight",
      requestPayload: {
        action: body.action,
        sessionId: body.sessionId,
      },
      responsePayload: resultPayload,
    });

    return Response.json(resultPayload);
  } catch (error) {
    await updateEvalTrace({
      supabase,
      traceId,
      status: "error",
      responsePayload: {},
      errorMessage: error instanceof Error ? error.message : String(error),
      startedAtMs,
    });

    return Response.json(
      { error: error instanceof Error ? error.message : "保存洞察失败" },
      { status: 500 }
    );
  }
}

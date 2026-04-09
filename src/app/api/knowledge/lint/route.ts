import { createServerSupabase } from "@/lib/supabase-server";
import { runKnowledgeLint } from "@/lib/knowledge";
import { createEvalTrace, runEvalSpan, updateEvalTrace } from "@/lib/evals";
import { getConfiguredModelName } from "@/lib/models";

export async function POST() {
  const requestStartedAtMs = Date.now();

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const modelName = getConfiguredModelName("light");
  const traceId = await createEvalTrace({
    supabase,
    userId: user.id,
    entryPoint: "lint",
    modelName,
    promptVersion: "lint-v1",
    requestPayload: {},
    metadata: {},
  });

  try {
    const report = await runEvalSpan({
      supabase,
      userId: user.id,
      traceId,
      spanName: "run_knowledge_lint",
      inputPayload: {},
      fn: () => runKnowledgeLint(supabase, user.id),
      outputMapper: (value) => ({
        totalItems: value.totalItems,
        contradictions: value.contradictions.length,
        orphans: value.orphans.length,
        staleItems: value.staleItems.length,
        blindSpots: value.blindSpots.length,
      }),
    });

    await updateEvalTrace({
      supabase,
      traceId,
      status: "success",
      responsePayload: report,
      metadata: { totalItems: report.totalItems },
      startedAtMs: requestStartedAtMs,
    });

    if (report.totalItems < 5) {
      return Response.json({
        ...report,
        message: "知识库条目不足 5 条，暂时无法运行健康检查。",
      });
    }

    return Response.json(report);
  } catch (err) {
    console.error("Knowledge lint error:", err);
    await updateEvalTrace({
      supabase,
      traceId,
      status: "error",
      responsePayload: {},
      metadata: {},
      errorMessage: err instanceof Error ? err.message : String(err),
      startedAtMs: requestStartedAtMs,
    });

    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

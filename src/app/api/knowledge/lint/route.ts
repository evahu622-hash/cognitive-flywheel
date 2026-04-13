import { createServerSupabase } from "@/lib/supabase-server";
import { getConfiguredModelName } from "@/lib/models";
import { runLintWithEval } from "@/lib/eval-pipelines";

export const maxDuration = 300;

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
  try {
    const { report } = await runLintWithEval({
      supabase,
      userId: user.id,
      modelName,
      startedAtMs: requestStartedAtMs,
      triggerSource: "manual",
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
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

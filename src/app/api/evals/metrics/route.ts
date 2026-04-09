import { createServerSupabase } from "@/lib/supabase-server";
import { buildEvalMetrics } from "@/lib/eval-metrics";
import {
  buildEvalSetupRequiredPayload,
  isMissingEvalTableMessage,
} from "@/lib/eval-setup";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [tracesResponse, resultsResponse, feedbackResponse, labelsResponse] =
    await Promise.all([
      supabase
        .from("eval_traces")
        .select("*")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(500),
      supabase
        .from("eval_results")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(2000),
      supabase
        .from("eval_feedback")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("eval_labels")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);

  const firstError = [
    tracesResponse.error,
    resultsResponse.error,
    feedbackResponse.error,
    labelsResponse.error,
  ].find(Boolean);

  if (firstError) {
    if (isMissingEvalTableMessage(firstError.message)) {
      return Response.json(buildEvalSetupRequiredPayload(firstError.message), {
        status: 503,
      });
    }
    return Response.json({ error: firstError.message }, { status: 500 });
  }

  return Response.json(
    buildEvalMetrics({
      traces: tracesResponse.data ?? [],
      results: resultsResponse.data ?? [],
      feedback: feedbackResponse.data ?? [],
      labels: labelsResponse.data ?? [],
    })
  );
}

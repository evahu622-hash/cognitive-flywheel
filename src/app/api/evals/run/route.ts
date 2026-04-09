import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildEvalSetupRequiredPayload,
  isMissingEvalTableMessage,
} from "@/lib/eval-setup";
import { runCodeEvaluatorsForTrace } from "@/lib/evaluators";

interface RunEvalRequest {
  traceId: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as RunEvalRequest;

  if (!body.traceId) {
    return Response.json({ error: "缺少 traceId" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: trace, error } = await supabase
    .from("eval_traces")
    .select("id, entry_point, mode, request_payload, response_payload, metadata")
    .eq("id", body.traceId)
    .eq("user_id", user.id)
    .single();

  if (error) {
    if (isMissingEvalTableMessage(error.message)) {
      return Response.json(buildEvalSetupRequiredPayload(error.message), {
        status: 503,
      });
    }
    return Response.json({ error: error.message }, { status: 404 });
  }

  const runId = `manual-${Date.now()}`;
  await runCodeEvaluatorsForTrace({
    supabase,
    userId: user.id,
    traceId: trace.id,
    entryPoint: trace.entry_point,
    mode: trace.mode,
    requestPayload: trace.request_payload,
    responsePayload: trace.response_payload,
    metadata: trace.metadata,
    runId,
  });

  return Response.json({ ok: true, runId });
}

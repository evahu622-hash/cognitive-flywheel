import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildEvalSetupRequiredPayload,
  isMissingEvalTableMessage,
} from "@/lib/eval-setup";
import { recordEvalResult } from "@/lib/evals";
import { runLLMJudge, type LLMJudgeName } from "@/lib/llm-judges";

interface JudgeRequest {
  traceId: string;
  judgeName: LLMJudgeName;
}

export async function POST(req: Request) {
  const body = (await req.json()) as JudgeRequest;

  if (!body.traceId || !body.judgeName) {
    return Response.json({ error: "缺少 traceId 或 judgeName" }, { status: 400 });
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
    .select("*")
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

  try {
    const result = await runLLMJudge(trace, body.judgeName);
    await recordEvalResult({
      supabase,
      userId: user.id,
      traceId: body.traceId,
      evaluatorName: result.judgeName,
      evaluatorType: "llm_judge",
      passFail: result.passFail,
      reason: result.reason,
      metadata: {
        modelName: result.modelName,
      },
      runId: `judge-${Date.now()}`,
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LLM judge 运行失败";
    if (isMissingEvalTableMessage(message)) {
      return Response.json(buildEvalSetupRequiredPayload(message), {
        status: 503,
      });
    }
    return Response.json(
      { error: message },
      { status: 500 }
    );
  }
}

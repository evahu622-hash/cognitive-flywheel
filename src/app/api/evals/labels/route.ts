import { createServerSupabase } from "@/lib/supabase-server";
import {
  buildEvalSetupRequiredPayload,
  isMissingEvalTableMessage,
} from "@/lib/eval-setup";

interface LabelRequest {
  traceId: string;
  failureCode?: string;
  passFail?: boolean | null;
  notes?: string;
  datasetName?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as LabelRequest;

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

  const { error } = await supabase.from("eval_labels").insert({
    user_id: user.id,
    trace_id: body.traceId,
    dataset_name: body.datasetName ?? "manual-review",
    reviewer: user.email ?? user.id,
    failure_code: body.failureCode ?? null,
    pass_fail: body.passFail ?? null,
    notes: body.notes ?? null,
  });

  if (error) {
    if (isMissingEvalTableMessage(error.message)) {
      return Response.json(buildEvalSetupRequiredPayload(error.message), {
        status: 503,
      });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

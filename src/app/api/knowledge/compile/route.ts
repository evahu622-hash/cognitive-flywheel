import { createServerSupabase } from "@/lib/supabase-server";
import { getConfiguredModelName } from "@/lib/models";
import { runCompileWithEval } from "@/lib/eval-pipelines";

export async function POST(req: Request) {
  const requestStartedAtMs = Date.now();

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const domain: string = body.domain || "";

  if (!domain.trim()) {
    return Response.json(
      { error: "domain is required" },
      { status: 400 }
    );
  }

  const modelName = getConfiguredModelName("light");

  try {
    const { result } = await runCompileWithEval({
      supabase,
      userId: user.id,
      domain,
      modelName,
      startedAtMs: requestStartedAtMs,
      triggerSource: "manual",
    });

    return Response.json({
      compiled_content: result.compiled_content,
      source_ids: result.source_ids,
      version: result.version,
      domain,
    });
  } catch (err) {
    console.error("Compile domain summary error:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

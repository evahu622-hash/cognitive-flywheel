import { createServerSupabase } from "@/lib/supabase-server";
import { compileDomainSummary } from "@/lib/knowledge";
import { createEvalTrace, runEvalSpan, updateEvalTrace } from "@/lib/evals";
import { getConfiguredModelName } from "@/lib/models";

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
  const traceId = await createEvalTrace({
    supabase,
    userId: user.id,
    entryPoint: "compile",
    modelName,
    promptVersion: "compile-v1",
    requestPayload: { domain },
    metadata: { domain },
  });

  try {
    const result = await runEvalSpan({
      supabase,
      userId: user.id,
      traceId,
      spanName: "compile_domain_summary",
      inputPayload: { domain },
      fn: () => compileDomainSummary(supabase, user.id, domain),
      outputMapper: (value) => ({
        version: value.version,
        sourceCount: value.source_ids.length,
      }),
    });

    await updateEvalTrace({
      supabase,
      traceId,
      status: "success",
      responsePayload: {
        domain,
        compiled_content: result.compiled_content,
        version: result.version,
        source_ids: result.source_ids,
      },
      metadata: { domain },
      startedAtMs: requestStartedAtMs,
    });

    return Response.json({
      compiled_content: result.compiled_content,
      source_ids: result.source_ids,
      version: result.version,
      domain,
    });
  } catch (err) {
    console.error("Compile domain summary error:", err);
    await updateEvalTrace({
      supabase,
      traceId,
      status: "error",
      responsePayload: {},
      metadata: { domain },
      errorMessage: err instanceof Error ? err.message : String(err),
      startedAtMs: requestStartedAtMs,
    });

    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

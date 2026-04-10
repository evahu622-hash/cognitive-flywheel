import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  PROMPT_VERSIONS,
  createEvalTrace,
  runEvalSpan,
  updateEvalTrace,
} from "./evals";
import { runCodeEvaluatorsForTrace } from "./evaluators";
import { compileDomainSummary, runKnowledgeLint } from "./knowledge";

type AppSupabase = SupabaseClient<Database>;

interface SourcePreviewItem {
  id: string;
  title: string;
  summary: string;
  tags: string[] | null;
  created_at: string;
}

function buildSourcePreview(items: SourcePreviewItem[]) {
  return items.slice(0, 8).map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary.slice(0, 240),
    tags: (item.tags ?? []).slice(0, 6),
    created_at: item.created_at,
  }));
}

async function fetchDomainSourcePreview(
  supabase: AppSupabase,
  userId: string,
  domain: string
) {
  const { data } = await supabase
    .from("knowledge_items")
    .select("id, title, summary, tags, created_at")
    .eq("user_id", userId)
    .eq("domain", domain)
    .order("created_at", { ascending: false })
    .limit(8);

  return buildSourcePreview((data ?? []) as SourcePreviewItem[]);
}

async function fetchPreviousSummary(
  supabase: AppSupabase,
  userId: string,
  domain: string
) {
  const { data } = await supabase
    .from("knowledge_summaries")
    .select("version, source_ids, compiled_content")
    .eq("user_id", userId)
    .eq("domain", domain)
    .is("topic", null)
    .single();

  return data
    ? {
        previousVersion: data.version ?? 0,
        previousSourceCount: data.source_ids?.length ?? 0,
        previousCompiledPreview: data.compiled_content.slice(0, 1200),
      }
    : {
        previousVersion: 0,
        previousSourceCount: 0,
        previousCompiledPreview: null,
      };
}

interface RunCompileWithEvalInput {
  supabase: AppSupabase;
  userId: string;
  domain: string;
  modelName: string | null;
  startedAtMs?: number;
  triggerSource?: string;
  sourceTraceId?: string | null;
}

export async function runCompileWithEval({
  supabase,
  userId,
  domain,
  modelName,
  startedAtMs = Date.now(),
  triggerSource = "manual",
  sourceTraceId = null,
}: RunCompileWithEvalInput) {
  const [sourcePreview, previousSummary] = await Promise.all([
    fetchDomainSourcePreview(supabase, userId, domain),
    fetchPreviousSummary(supabase, userId, domain),
  ]);

  const requestPayload = {
    domain,
    triggerSource,
    sourceTraceId,
  };
  const baseMetadata = {
    domain,
    triggerSource,
    sourceTraceId,
    sourcePreview,
    ...previousSummary,
  };

  const traceId = await createEvalTrace({
    supabase,
    userId,
    entryPoint: "compile",
    sourceType: triggerSource,
    modelName,
    promptVersion: PROMPT_VERSIONS.compile,
    requestPayload,
    metadata: baseMetadata,
  });

  try {
    const result = await runEvalSpan({
      supabase,
      userId,
      traceId,
      spanName: "compile_domain_summary",
      inputPayload: requestPayload,
      fn: () => compileDomainSummary(supabase, userId, domain),
      outputMapper: (value) => ({
        version: value.version,
        sourceCount: value.source_ids.length,
      }),
    });

    const responsePayload = {
      domain,
      compiled_content: result.compiled_content,
      version: result.version,
      source_ids: result.source_ids,
    };
    const metadata = {
      ...baseMetadata,
      sourceCount: result.source_ids.length,
    };

    await updateEvalTrace({
      supabase,
      traceId,
      status: "success",
      responsePayload,
      metadata,
      startedAtMs,
    });

    await runCodeEvaluatorsForTrace({
      supabase,
      userId,
      traceId,
      entryPoint: "compile",
      requestPayload,
      responsePayload,
      metadata,
    });

    return { traceId, result };
  } catch (error) {
    await updateEvalTrace({
      supabase,
      traceId,
      status: "error",
      responsePayload: {},
      metadata: baseMetadata,
      errorMessage: error instanceof Error ? error.message : String(error),
      startedAtMs,
    });

    throw error;
  }
}

interface RunLintWithEvalInput {
  supabase: AppSupabase;
  userId: string;
  modelName: string | null;
  startedAtMs?: number;
  triggerSource?: string;
}

export async function runLintWithEval({
  supabase,
  userId,
  modelName,
  startedAtMs = Date.now(),
  triggerSource = "manual",
}: RunLintWithEvalInput) {
  const requestPayload = {
    triggerSource,
  };
  const baseMetadata = {
    triggerSource,
  };

  const traceId = await createEvalTrace({
    supabase,
    userId,
    entryPoint: "lint",
    sourceType: triggerSource,
    modelName,
    promptVersion: PROMPT_VERSIONS.lint,
    requestPayload,
    metadata: baseMetadata,
  });

  try {
    const report = await runEvalSpan({
      supabase,
      userId,
      traceId,
      spanName: "run_knowledge_lint",
      inputPayload: requestPayload,
      fn: () => runKnowledgeLint(supabase, userId),
      outputMapper: (value) => ({
        totalItems: value.totalItems,
        contradictions: value.contradictions.length,
        orphans: value.orphans.length,
        staleItems: value.staleItems.length,
        blindSpots: value.blindSpots.length,
      }),
    });

    const metadata = {
      ...baseMetadata,
      totalItems: report.totalItems,
    };

    await updateEvalTrace({
      supabase,
      traceId,
      status: "success",
      responsePayload: report,
      metadata,
      startedAtMs,
    });

    await runCodeEvaluatorsForTrace({
      supabase,
      userId,
      traceId,
      entryPoint: "lint",
      requestPayload,
      responsePayload: report,
      metadata,
    });

    return { traceId, report };
  } catch (error) {
    await updateEvalTrace({
      supabase,
      traceId,
      status: "error",
      responsePayload: {},
      metadata: baseMetadata,
      errorMessage: error instanceof Error ? error.message : String(error),
      startedAtMs,
    });

    throw error;
  }
}

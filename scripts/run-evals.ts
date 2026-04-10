/**
 * 对所有成功的 traces 跑 code evaluators + LLM judges
 * Usage: npx tsx scripts/run-evals.mts
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
import { runCodeEvaluatorsForTrace } from "../src/lib/evaluators";
import { runLLMJudge } from "../src/lib/llm-judges";
import { LLM_JUDGE_OPTIONS } from "../src/lib/eval-options";
import { recordEvalResult } from "../src/lib/evals";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const uid = process.env.TEST_USER_ID!;

async function main() {
  // Get all successful traces
  const { data: traces, error } = await supabase
    .from("eval_traces")
    .select("*")
    .eq("user_id", uid)
    .eq("trace_status", "success")
    .order("started_at", { ascending: false });

  if (error || !traces) {
    console.error("Failed to fetch traces:", error?.message);
    process.exit(1);
  }

  console.log(`Found ${traces.length} successful traces\n`);

  // ── Step 1: Code Evaluators ─────────────────────────────────
  console.log("═══ Step 1: Code Evaluators ═══");

  for (const t of traces) {
    try {
      await runCodeEvaluatorsForTrace({
        supabase,
        userId: uid,
        traceId: t.id,
        entryPoint: t.entry_point as "feed" | "think" | "compile" | "lint",
        mode: t.mode,
        requestPayload: t.request_payload,
        responsePayload: t.response_payload,
        metadata: t.metadata,
        runId: "batch-eval-" + new Date().toISOString().slice(0, 10),
      });
      console.log(`  ${t.entry_point.padEnd(12)} ${t.id.slice(0, 8)} ✓`);
    } catch (e) {
      console.error(`  ${t.entry_point.padEnd(12)} ${t.id.slice(0, 8)} ✗ ${(e as Error).message}`);
    }
  }

  // ── Step 2: LLM Judges ─────────────────────────────────────
  console.log("\n═══ Step 2: LLM Judges ═══");

  for (const t of traces) {
    const applicableJudges = LLM_JUDGE_OPTIONS.filter((j) =>
      (j.entryPoints as readonly string[]).includes(t.entry_point)
    );

    if (applicableJudges.length === 0) {
      console.log(`  ${t.entry_point.padEnd(12)} ${t.id.slice(0, 8)} no judges applicable`);
      continue;
    }

    for (const judge of applicableJudges) {
      try {
        const result = await runLLMJudge(t, judge.name);
        await recordEvalResult({
          supabase,
          userId: uid,
          traceId: t.id,
          evaluatorName: result.judgeName,
          evaluatorType: "llm_judge",
          score: result.passFail ? 1 : 0,
          passFail: result.passFail,
          reason: result.reason,
          metadata: { modelName: result.modelName },
          runId: "batch-eval-" + new Date().toISOString().slice(0, 10),
        });
        const icon = result.passFail ? "✓" : "✗";
        console.log(`  ${t.entry_point.padEnd(12)} ${judge.name.padEnd(30)} ${icon} ${result.reason.slice(0, 60)}`);
      } catch (e) {
        console.error(`  ${t.entry_point.padEnd(12)} ${judge.name.padEnd(30)} ERROR: ${(e as Error).message.slice(0, 60)}`);
      }
      // Rate limit
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // ── Step 3: Summary ─────────────────────────────────────────
  console.log("\n═══ Step 3: Results Summary ═══");

  const { data: results } = await supabase
    .from("eval_results")
    .select("evaluator_name, evaluator_type, pass_fail, run_id")
    .eq("user_id", uid);

  // Only count latest batch
  const batchResults = (results || []).filter(
    (r) => r.run_id?.startsWith("batch-eval-") || r.run_id === "auto"
  );

  const summary: Record<string, { pass: number; fail: number; type: string }> = {};
  for (const r of batchResults) {
    if (!summary[r.evaluator_name]) {
      summary[r.evaluator_name] = { pass: 0, fail: 0, type: r.evaluator_type };
    }
    if (r.pass_fail) summary[r.evaluator_name].pass++;
    else summary[r.evaluator_name].fail++;
  }

  console.log("\nCode Evaluators:");
  for (const [name, s] of Object.entries(summary).filter(([, v]) => v.type === "code")) {
    const total = s.pass + s.fail;
    const rate = total > 0 ? ((s.pass / total) * 100).toFixed(0) : "N/A";
    console.log(`  ${name.padEnd(35)} ${rate}% (${s.pass}/${total})`);
  }

  console.log("\nLLM Judges:");
  for (const [name, s] of Object.entries(summary).filter(([, v]) => v.type === "llm_judge")) {
    const total = s.pass + s.fail;
    const rate = total > 0 ? ((s.pass / total) * 100).toFixed(0) : "N/A";
    console.log(`  ${name.padEnd(35)} ${rate}% (${s.pass}/${total})`);
  }

  // Overall health
  const allCode = Object.entries(summary).filter(([, v]) => v.type === "code");
  const allJudge = Object.entries(summary).filter(([, v]) => v.type === "llm_judge");
  const codePass = allCode.reduce((sum, [, v]) => sum + v.pass, 0);
  const codeTotal = allCode.reduce((sum, [, v]) => sum + v.pass + v.fail, 0);
  const judgePass = allJudge.reduce((sum, [, v]) => sum + v.pass, 0);
  const judgeTotal = allJudge.reduce((sum, [, v]) => sum + v.pass + v.fail, 0);

  console.log(`\nOverall: Code ${codePass}/${codeTotal} (${codeTotal > 0 ? ((codePass/codeTotal)*100).toFixed(0) : 'N/A'}%), Judges ${judgePass}/${judgeTotal} (${judgeTotal > 0 ? ((judgePass/judgeTotal)*100).toFixed(0) : 'N/A'}%)`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

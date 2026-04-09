import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const entryPoint = getArg("entry-point");
const status = getArg("status");
const limit = Number(getArg("limit", "100"));
const outputPath = getArg(
  "out",
  path.join(process.cwd(), "evals", "datasets", "trace-export.jsonl")
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let query = supabase
  .from("eval_traces")
  .select("*")
  .order("started_at", { ascending: false })
  .limit(Number.isFinite(limit) ? limit : 100);

if (entryPoint) {
  query = query.eq("entry_point", entryPoint);
}

if (status) {
  query = query.eq("trace_status", status);
}

const { data: traces, error } = await query;

if (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = [];

for (const trace of traces ?? []) {
  const [spansResponse, resultsResponse, feedbackResponse, labelsResponse] =
    await Promise.all([
      supabase
        .from("eval_spans")
        .select("*")
        .eq("trace_id", trace.id)
        .order("started_at", { ascending: true }),
      supabase
        .from("eval_results")
        .select("*")
        .eq("trace_id", trace.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("eval_feedback")
        .select("*")
        .or(`trace_id.eq.${trace.id},think_session_id.eq.${trace.session_id ?? "00000000-0000-0000-0000-000000000000"}`)
        .order("created_at", { ascending: true }),
      supabase
        .from("eval_labels")
        .select("*")
        .eq("trace_id", trace.id)
        .order("created_at", { ascending: true }),
    ]);

  rows.push(
    JSON.stringify({
      trace,
      spans: spansResponse.data ?? [],
      results: resultsResponse.data ?? [],
      feedback: feedbackResponse.data ?? [],
      labels: labelsResponse.data ?? [],
    })
  );
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${rows.join("\n")}\n`, "utf8");

console.log(`Exported ${rows.length} traces to ${outputPath}`);

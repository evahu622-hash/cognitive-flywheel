import fs from "node:fs";
import path from "node:path";

const DEFAULT_THRESHOLDS = {
  feed_summary_faithful: 0.85,
  feed_relationship_accurate: 0.80,
  feed_spark_surprising: 0.70,
  think_mode_fit: 0.85,
  compile_faithful: 0.85,
  lint_contradiction_valid: 0.80,
  guardrail_fabricated_fact: 1,
};

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function parseJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getLatestResults(results) {
  return [...results]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .reduce((acc, result) => {
      acc.set(result.evaluator_name, result);
      return acc;
    }, new Map());
}

const inputPath = getArg(
  "input",
  path.join(process.cwd(), "evals", "datasets", "splits", "dev.jsonl")
);

const dataset = parseJsonl(inputPath);

if (dataset.length === 0) {
  console.log(`No dataset rows found at ${inputPath}, skipping eval gate.`);
  process.exit(0);
}

const stats = new Map();

for (const row of dataset) {
  const latestResults = getLatestResults(row.results ?? []);
  for (const [name, result] of latestResults.entries()) {
    const bucket = stats.get(name) ?? { total: 0, pass: 0, fail: 0 };
    bucket.total += 1;
    if (result.pass_fail === true) bucket.pass += 1;
    if (result.pass_fail === false) bucket.fail += 1;
    stats.set(name, bucket);
  }
}

let hasFailure = false;

for (const [name, threshold] of Object.entries(DEFAULT_THRESHOLDS)) {
  const bucket = stats.get(name);

  if (!bucket || bucket.total === 0) {
    console.log(`SKIP ${name}: no samples`);
    continue;
  }

  const passRate = bucket.pass / bucket.total;
  const summary = `${name}: ${(passRate * 100).toFixed(1)}% (${bucket.pass}/${bucket.total})`;

  if (passRate < threshold) {
    console.error(`FAIL ${summary}, threshold ${(threshold * 100).toFixed(0)}%`);
    hasFailure = true;
  } else {
    console.log(`PASS ${summary}`);
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log("Eval gate passed.");

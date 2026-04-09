import fs from "node:fs";
import path from "node:path";

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

function latestBy(items, key) {
  return [...items]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .reduce((acc, item) => {
      acc.set(item[key], item);
      return acc;
    }, new Map());
}

function ratio(value, total) {
  return total > 0 ? value / total : 0;
}

const inputPath = getArg(
  "input",
  path.join(process.cwd(), "evals", "datasets", "splits", "dev.jsonl")
);
const datasetName = getArg("dataset-name", "manual-review");
const evaluator = getArg("evaluator");

const dataset = parseJsonl(inputPath);

if (dataset.length === 0) {
  console.log(`No dataset rows found at ${inputPath}`);
  process.exit(0);
}

const totals = new Map();

for (const row of dataset) {
  const labels = (row.labels ?? []).filter(
    (label) => (label.dataset_name ?? "manual-review") === datasetName
  );
  if (labels.length === 0) continue;

  const latestLabels = latestBy(labels, "trace_id");
  const latestResults = latestBy(row.results ?? [], "evaluator_name");

  for (const label of latestLabels.values()) {
    if (typeof label.pass_fail !== "boolean") continue;

    const evaluatorsToCheck = evaluator
      ? [evaluator]
      : [...latestResults.keys()];

    for (const evaluatorName of evaluatorsToCheck) {
      const result = latestResults.get(evaluatorName);
      if (!result || typeof result.pass_fail !== "boolean") continue;

      const bucket = totals.get(evaluatorName) ?? {
        total: 0,
        tp: 0,
        tn: 0,
        fp: 0,
        fn: 0,
      };

      bucket.total += 1;
      if (result.pass_fail === true && label.pass_fail === true) bucket.tp += 1;
      if (result.pass_fail === false && label.pass_fail === false) bucket.tn += 1;
      if (result.pass_fail === true && label.pass_fail === false) bucket.fp += 1;
      if (result.pass_fail === false && label.pass_fail === true) bucket.fn += 1;

      totals.set(evaluatorName, bucket);
    }
  }
}

if (totals.size === 0) {
  console.log(
    `No comparable samples found for dataset=${datasetName}${evaluator ? ` evaluator=${evaluator}` : ""}`
  );
  process.exit(0);
}

for (const [evaluatorName, bucket] of totals.entries()) {
  const accuracy = ratio(bucket.tp + bucket.tn, bucket.total);
  const precision = ratio(bucket.tp, bucket.tp + bucket.fp);
  const tpr = ratio(bucket.tp, bucket.tp + bucket.fn);
  const tnr = ratio(bucket.tn, bucket.tn + bucket.fp);

  console.log(`\n${evaluatorName}`);
  console.log(`samples: ${bucket.total}`);
  console.log(`accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(`precision: ${(precision * 100).toFixed(1)}%`);
  console.log(`TPR/recall: ${(tpr * 100).toFixed(1)}%`);
  console.log(`TNR/specificity: ${(tnr * 100).toFixed(1)}%`);
  console.log(
    `confusion: TP ${bucket.tp}, TN ${bucket.tn}, FP ${bucket.fp}, FN ${bucket.fn}`
  );
}

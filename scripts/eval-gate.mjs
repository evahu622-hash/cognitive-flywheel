import path from "node:path";
import {
  GATE_REQUIREMENTS,
  buildEntryPointCounts,
  formatPercent,
  getArg,
  getBooleanArg,
  parseJsonl,
  summarizeRequirement,
} from "./eval-gate-config.mjs";

const inputPath = getArg(
  "input",
  path.join(process.cwd(), "evals", "datasets", "splits", "dev.jsonl")
);
const strictCoverage = getBooleanArg("strict-coverage", true);

const dataset = parseJsonl(inputPath);

if (dataset.length === 0) {
  console.error(`FAIL dataset: no rows found at ${inputPath}`);
  process.exit(1);
}

console.log(`Dataset: ${inputPath}`);
console.log(`Rows: ${dataset.length}`);
console.log(`Strict coverage: ${strictCoverage ? "on" : "off"}\n`);

console.log("Entry Point Coverage:");
for (const [entryPoint, bucket] of [...buildEntryPointCounts(dataset).entries()].sort()) {
  console.log(
    `  ${entryPoint.padEnd(14)} total ${String(bucket.total).padStart(3)} | success ${String(bucket.success).padStart(3)}`
  );
}
console.log("");

let hasFailure = false;

for (const requirement of GATE_REQUIREMENTS) {
  const summary = summarizeRequirement(dataset, requirement);
  const prefix = `${summary.evaluatorName}:`;

  if (summary.relevantTraceCount === 0) {
    console.error(
      `FAIL COVERAGE ${prefix} no successful ${summary.entryPoints.join("/")} traces in dataset`
    );
    hasFailure = true;
    continue;
  }

  if (strictCoverage && summary.missingResultCount > 0) {
    console.error(
      `FAIL COVERAGE ${prefix} missing evaluator result on ${summary.missingResultCount}/${summary.relevantTraceCount} relevant traces`
    );
    hasFailure = true;
    continue;
  }

  if (summary.evaluatedCount < summary.minSamples) {
    console.error(
      `FAIL COVERAGE ${prefix} only ${summary.evaluatedCount} evaluated samples, need >= ${summary.minSamples}`
    );
    hasFailure = true;
    continue;
  }

  const passRate = summary.passRate ?? 0;
  const line = `${prefix} ${formatPercent(passRate)} (${summary.passCount}/${summary.evaluatedCount})`;

  if (passRate < summary.threshold) {
    console.error(
      `FAIL QUALITY ${line}, threshold ${formatPercent(summary.threshold)}`
    );
    hasFailure = true;
  } else {
    console.log(`PASS ${line}`);
  }
}

if (hasFailure) {
  process.exit(1);
}

console.log("\nEval gate passed.");

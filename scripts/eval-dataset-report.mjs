import path from "node:path";
import {
  GATE_REQUIREMENTS,
  buildEntryPointCounts,
  formatPercent,
  getArg,
  parseJsonl,
  summarizeRequirement,
} from "./eval-gate-config.mjs";

const inputPath = getArg(
  "input",
  path.join(process.cwd(), "evals", "datasets", "splits", "dev.jsonl")
);

const dataset = parseJsonl(inputPath);

if (dataset.length === 0) {
  console.error(`No dataset rows found at ${inputPath}`);
  process.exit(1);
}

console.log(`Dataset Coverage Report: ${inputPath}`);
console.log(`Rows: ${dataset.length}\n`);

console.log("Entry Point Coverage:");
for (const [entryPoint, bucket] of [...buildEntryPointCounts(dataset).entries()].sort()) {
  console.log(
    `  ${entryPoint.padEnd(14)} total ${String(bucket.total).padStart(3)} | success ${String(bucket.success).padStart(3)}`
  );
}

console.log("\nGate Requirement Coverage:");
for (const requirement of GATE_REQUIREMENTS) {
  const summary = summarizeRequirement(dataset, requirement);
  const passRate =
    summary.passRate == null ? "n/a" : formatPercent(summary.passRate);

  console.log(`  ${summary.evaluatorName}`);
  console.log(`    entry points: ${summary.entryPoints.join(", ")}`);
  console.log(`    relevant success traces: ${summary.relevantTraceCount}`);
  console.log(`    evaluated samples: ${summary.evaluatedCount}`);
  console.log(`    missing results: ${summary.missingResultCount}`);
  console.log(`    min samples: ${summary.minSamples}`);
  console.log(`    threshold: ${formatPercent(summary.threshold)}`);
  console.log(`    current pass rate: ${passRate}`);
}

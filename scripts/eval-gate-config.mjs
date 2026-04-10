import fs from "node:fs";

export const GATE_REQUIREMENTS = [
  {
    evaluatorName: "feed_summary_faithful",
    entryPoints: ["feed"],
    threshold: 0.85,
    minSamples: 5,
  },
  {
    evaluatorName: "feed_relationship_accurate",
    entryPoints: ["feed"],
    threshold: 0.8,
    minSamples: 4,
  },
  {
    evaluatorName: "feed_spark_surprising",
    entryPoints: ["feed"],
    threshold: 0.7,
    minSamples: 4,
  },
  {
    evaluatorName: "think_mode_fit",
    entryPoints: ["think"],
    threshold: 0.85,
    minSamples: 5,
  },
  {
    evaluatorName: "compile_faithful",
    entryPoints: ["compile"],
    threshold: 0.85,
    minSamples: 3,
  },
  {
    evaluatorName: "lint_contradiction_valid",
    entryPoints: ["lint"],
    threshold: 0.8,
    minSamples: 3,
  },
  {
    evaluatorName: "guardrail_fabricated_fact",
    entryPoints: ["feed", "think", "compile"],
    threshold: 1,
    minSamples: 6,
  },
];

export function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

export function getBooleanArg(name, fallback = true) {
  const value = getArg(name, null);
  if (value == null) return fallback;
  return value !== "false";
}

export function parseJsonl(filePath) {
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

export function getLatestResults(results) {
  return [...results]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .reduce((acc, result) => {
      acc.set(result.evaluator_name, result);
      return acc;
    }, new Map());
}

export function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildEntryPointCounts(dataset) {
  return dataset.reduce((acc, row) => {
    const entryPoint = row.trace?.entry_point;
    if (!entryPoint) return acc;

    const bucket = acc.get(entryPoint) ?? { total: 0, success: 0 };
    bucket.total += 1;
    if (row.trace?.trace_status === "success") {
      bucket.success += 1;
    }
    acc.set(entryPoint, bucket);
    return acc;
  }, new Map());
}

export function summarizeRequirement(dataset, requirement) {
  const relevantRows = dataset.filter((row) => {
    const trace = row.trace;
    return (
      trace?.trace_status === "success" &&
      requirement.entryPoints.includes(trace.entry_point)
    );
  });

  let evaluatedCount = 0;
  let passCount = 0;
  let failCount = 0;
  let missingResultCount = 0;

  for (const row of relevantRows) {
    const result = getLatestResults(row.results ?? []).get(requirement.evaluatorName);
    if (!result) {
      missingResultCount += 1;
      continue;
    }

    evaluatedCount += 1;
    if (result.pass_fail === true) passCount += 1;
    if (result.pass_fail === false) failCount += 1;
  }

  return {
    ...requirement,
    relevantTraceCount: relevantRows.length,
    evaluatedCount,
    passCount,
    failCount,
    missingResultCount,
    passRate: evaluatedCount > 0 ? passCount / evaluatedCount : null,
  };
}

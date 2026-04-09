import fs from "node:fs";
import path from "node:path";

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function stableHash(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const inputPath = getArg(
  "input",
  path.join(process.cwd(), "evals", "datasets", "trace-export.jsonl")
);
const outputDir = getArg(
  "out-dir",
  path.join(process.cwd(), "evals", "datasets", "splits")
);
const trainRatio = Number(getArg("train", "0.8"));
const devRatio = Number(getArg("dev", "0.1"));
const testRatio = Number(getArg("test", "0.1"));

if (Math.abs(trainRatio + devRatio + testRatio - 1) > 0.001) {
  console.error("train/dev/test ratio 必须加总为 1");
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  process.exit(1);
}

const lines = fs
  .readFileSync(inputPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const buckets = {
  train: [],
  dev: [],
  test: [],
};

for (const line of lines) {
  const parsed = JSON.parse(line);
  const traceId = parsed?.trace?.id ?? line;
  const bucketSeed = stableHash(String(traceId)) / 0xffffffff;

  if (bucketSeed < trainRatio) {
    buckets.train.push(line);
  } else if (bucketSeed < trainRatio + devRatio) {
    buckets.dev.push(line);
  } else {
    buckets.test.push(line);
  }
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "train.jsonl"), `${buckets.train.join("\n")}\n`);
fs.writeFileSync(path.join(outputDir, "dev.jsonl"), `${buckets.dev.join("\n")}\n`);
fs.writeFileSync(path.join(outputDir, "test.jsonl"), `${buckets.test.join("\n")}\n`);

console.log(
  `Split ${lines.length} rows -> train ${buckets.train.length}, dev ${buckets.dev.length}, test ${buckets.test.length}`
);

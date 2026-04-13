/**
 * 用 Claude (通过 Claude Code CLI 订阅) 作为独立 judge 重新打分。
 * 目的: 消除 MiniMax 既当生成又当 judge 的自偏见问题。
 *
 * 用法:
 *   npx tsx scripts/rejudge-with-claude.ts <path/to/raw.json> [--model claude-haiku-4-5]
 *
 * 依赖:
 *   - `claude` CLI 已登录 (OAuth,走订阅,不消耗 ANTHROPIC_API_KEY)
 *
 * 输出:
 *   {input-dir}-claude-judged/raw.json + summary.md
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ThinkMode } from "../src/lib/think-prompts";

const args = process.argv.slice(2);
const inputPath = args[0];
const modelIdx = args.indexOf("--model");
const JUDGE_MODEL = modelIdx >= 0 ? args[modelIdx + 1] : "claude-haiku-4-5";

if (!inputPath) {
  console.error("Usage: npx tsx scripts/rejudge-with-claude.ts <path/to/raw.json> [--model claude-haiku-4-5]");
  process.exit(1);
}

function cleanAIResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  const cleaned = cleanAIResponse(raw);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const JUDGE_PROMPT_PREFIX = `你是严格、客观的 AI 评估专家。请对「认知飞轮」产品中的 AI 思考模式回答进行打分。

你本身从未参与生成这些回答,请以完全中立的视角评判。

评分维度 (每项 0-5 整数,5=最好,0=完全不满足):
1. accuracy (准确性): 事实是否正确,推断是否严谨,有无编造 — 对 mirror/coach 尤其重要
2. insight (洞察深度): 是否提供非显而易见的真正价值,是否只是陈词滥调/套话
3. actionable (可操作性): 建议是否能直接落地,有无具体步骤/资源/书名 — 对 coach 尤其重要
4. structure (结构性): 类比是否深层真正同构,还是只是表面相似 — 对 crossdomain 尤其重要

另外一个 json_valid 字段: true 如果生成的 JSON 结构符合该模式的 schema (字段完整),false 如果缺字段/错字段。

严格输出 JSON,不要 markdown 代码块,不要解释:
{"accuracy": 0-5, "insight": 0-5, "actionable": 0-5, "structure": 0-5, "json_valid": true|false, "comment": "一句话说明关键问题或亮点"}

`;

interface JudgeScore {
  accuracy: number;
  insight: number;
  actionable: number;
  structure: number;
  json_valid: boolean;
  comment: string;
}

function callClaudeCli(fullPrompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--output-format", "text", "--model", JUDGE_MODEL], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(stdout);
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

async function judgeOne(
  mode: ThinkMode,
  question: string,
  rawAnswer: string,
  parsed: Record<string, unknown> | null,
  attempt = 1
): Promise<JudgeScore | null> {
  const fullPrompt = `${JUDGE_PROMPT_PREFIX}
模式: ${mode}
问题: ${question}

---- 模型原始输出 ----
${rawAnswer.slice(0, 6000)}

---- 解析后的 JSON ----
${parsed ? JSON.stringify(parsed).slice(0, 6000) : "(解析失败)"}

请按上述 5 项打分并输出 JSON。`;

  try {
    const out = await callClaudeCli(fullPrompt);
    const parsedJudge = tryParseJson(out);
    if (!parsedJudge) {
      if (attempt < 2) {
        return judgeOne(mode, question, rawAnswer, parsed, attempt + 1);
      }
      return null;
    }
    return {
      accuracy: Number(parsedJudge.accuracy ?? 0),
      insight: Number(parsedJudge.insight ?? 0),
      actionable: Number(parsedJudge.actionable ?? 0),
      structure: Number(parsedJudge.structure ?? 0),
      json_valid: Boolean(parsedJudge.json_valid),
      comment: String(parsedJudge.comment ?? ""),
    };
  } catch (err) {
    const msg = (err as Error).message;
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return judgeOne(mode, question, rawAnswer, parsed, attempt + 1);
    }
    console.warn(`  claude judge error [attempt ${attempt}]: ${msg.slice(0, 120)}`);
    return null;
  }
}

interface SampleResult {
  mode: ThinkMode;
  temperature: number;
  question: string;
  rawAnswer: string;
  parsed: Record<string, unknown> | null;
  parseOk: boolean;
  latencyMs: number;
  genError?: string;
  judge: JudgeScore | null;
}

async function main() {
  const data = JSON.parse(readFileSync(inputPath, "utf-8")) as {
    generationModel: string;
    judgeModel: string;
    n: number;
    results: SampleResult[];
  };

  console.log(`\n=== Claude-as-judge (独立评判) ===`);
  console.log(`Source: ${inputPath}`);
  console.log(`Generation model: ${data.generationModel}`);
  console.log(`Old judge model: ${data.judgeModel}`);
  console.log(`New judge model: ${JUDGE_MODEL} (via claude CLI / 订阅)`);
  console.log(`Total samples: ${data.results.length}\n`);

  // 清掉旧 judge,每个样本用 Claude 重新打分
  const rejudged: SampleResult[] = data.results.map((r) => ({ ...r, judge: null }));

  const CONCURRENCY = 4;
  let ok = 0;
  let fail = 0;
  let completed = 0;
  const total = rejudged.length;

  async function processOne(i: number) {
    const r = rejudged[i];
    if (!r.rawAnswer) {
      completed++;
      console.log(`[${completed}/${total}] ${r.mode} t=${r.temperature} -- skip (no rawAnswer)`);
      return;
    }
    const started = Date.now();
    const judge = await judgeOne(r.mode, r.question, r.rawAnswer, r.parsed);
    const elapsed = Date.now() - started;
    completed++;
    if (judge) {
      r.judge = judge;
      ok++;
      console.log(`[${completed}/${total}] ${r.mode} t=${r.temperature} acc=${judge.accuracy} ins=${judge.insight} act=${judge.actionable} str=${judge.structure} (${elapsed}ms)`);
    } else {
      fail++;
      console.log(`[${completed}/${total}] ${r.mode} t=${r.temperature} FAIL (${elapsed}ms)`);
    }
  }

  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch: Promise<void>[] = [];
    for (let j = i; j < Math.min(i + CONCURRENCY, total); j++) {
      batch.push(processOne(j));
    }
    await Promise.all(batch);
  }
  console.log(`\n${ok} ok, ${fail} failed`);

  // ── Aggregate ───────
  type Agg = {
    count: number;
    parseOk: number;
    jsonValid: number;
    avgLatencyMs: number;
    accuracy: number;
    insight: number;
    actionable: number;
    structure: number;
    total: number;
  };
  const buckets: Record<string, Agg> = {};
  for (const r of rejudged) {
    const key = `${r.mode}|${r.temperature}`;
    if (!buckets[key]) {
      buckets[key] = { count: 0, parseOk: 0, jsonValid: 0, avgLatencyMs: 0, accuracy: 0, insight: 0, actionable: 0, structure: 0, total: 0 };
    }
    const b = buckets[key];
    b.count++;
    if (r.parseOk) b.parseOk++;
    b.avgLatencyMs += r.latencyMs;
    if (r.judge) {
      if (r.judge.json_valid) b.jsonValid++;
      b.accuracy += r.judge.accuracy;
      b.insight += r.judge.insight;
      b.actionable += r.judge.actionable;
      b.structure += r.judge.structure;
      b.total += r.judge.accuracy + r.judge.insight + r.judge.actionable + r.judge.structure;
    }
  }

  const MODES: ThinkMode[] = ["roundtable", "coach", "crossdomain", "mirror"];
  const rows: Array<{ mode: ThinkMode; temp: number; count: number; parseOk: number; jsonValid: number; avgLatencyMs: number; accuracy: number; insight: number; actionable: number; structure: number; total: number; avgTotal: number; judgedN: number }> = [];
  for (const [key, b] of Object.entries(buckets)) {
    const [mode, tempStr] = key.split("|");
    const judgedN = rejudged.filter((r) => r.mode === mode && r.temperature === Number(tempStr) && r.judge).length;
    const divisor = judgedN || 1;
    rows.push({
      mode: mode as ThinkMode,
      temp: Number(tempStr),
      count: b.count,
      parseOk: b.parseOk,
      jsonValid: b.jsonValid,
      avgLatencyMs: Math.round(b.avgLatencyMs / b.count),
      accuracy: +(b.accuracy / divisor).toFixed(2),
      insight: +(b.insight / divisor).toFixed(2),
      actionable: +(b.actionable / divisor).toFixed(2),
      structure: +(b.structure / divisor).toFixed(2),
      total: b.total,
      avgTotal: +(b.total / divisor).toFixed(2),
      judgedN,
    });
  }
  rows.sort((a, b) => (a.mode === b.mode ? a.temp - b.temp : a.mode.localeCompare(b.mode)));

  const bestByMode: Record<string, { temp: number; score: number }> = {};
  for (const r of rows) {
    const cur = bestByMode[r.mode];
    if (!cur || r.avgTotal > cur.score) {
      bestByMode[r.mode] = { temp: r.temp, score: r.avgTotal };
    }
  }

  const parent = path.dirname(inputPath);
  const base = path.basename(parent);
  const outDir = path.join(path.dirname(parent), `${base}-claude-judged`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    path.join(outDir, "raw.json"),
    JSON.stringify({ ...data, judgeModel: JUDGE_MODEL, judgeTransport: "claude-cli-subscription", results: rejudged, rows, bestByMode }, null, 2),
    "utf-8"
  );

  let md = `# Temperature A/B Eval — Claude judge\n\n`;
  md += `- Source: \`${inputPath}\`\n`;
  md += `- Generation model: \`${data.generationModel}\`\n`;
  md += `- Judge model: \`${JUDGE_MODEL}\` (via \`claude -p\` CLI, 订阅 OAuth, 不消耗 API key)\n`;
  md += `- Questions per mode: ${data.n}\n`;
  md += `- Total generations: ${rejudged.length}\n`;
  md += `- Judged ok: ${ok} / failed: ${fail}\n\n`;
  md += `这一版 judge 和 generation 完全跨供应商,消除了 MiniMax 自评偏见。\n\n`;

  md += `## 分数对比表 (每项 0-5, avgTotal 满分 20)\n\n`;
  md += `| mode | temp | parseOk | judgedN | jsonValid | accuracy | insight | actionable | structure | **avgTotal** | latency |\n`;
  md += `|------|------|---------|---------|-----------|----------|---------|------------|-----------|--------------|---------|\n`;
  for (const r of rows) {
    const star = bestByMode[r.mode].temp === r.temp ? " ★" : "";
    md += `| ${r.mode} | ${r.temp} | ${r.parseOk}/${r.count} | ${r.judgedN}/${r.count} | ${r.jsonValid}/${r.count} | ${r.accuracy} | ${r.insight} | ${r.actionable} | ${r.structure} | **${r.avgTotal}${star}** | ${r.avgLatencyMs}ms |\n`;
  }

  md += `\n## 推荐的 per-mode 温度 (Claude judge)\n\n`;
  md += `| mode | 推荐温度 | 得分 |\n`;
  md += `|------|----------|------|\n`;
  for (const mode of MODES) {
    md += `| ${mode} | ${bestByMode[mode].temp} | ${bestByMode[mode].score} |\n`;
  }

  writeFileSync(path.join(outDir, "summary.md"), md, "utf-8");
  console.log(`\n结果写入: ${outDir}`);

  console.log(`\n## 对比表\n`);
  console.log(`mode        | temp | parseOk | judgedN | acc | ins | act | str | total | latency`);
  console.log(`------------|------|---------|---------|-----|-----|-----|-----|-------|--------`);
  for (const r of rows) {
    const star = bestByMode[r.mode].temp === r.temp ? " ★" : "  ";
    console.log(`${r.mode.padEnd(11)} | ${String(r.temp).padEnd(4)} | ${(`${r.parseOk}/${r.count}`).padEnd(7)} | ${(`${r.judgedN}/${r.count}`).padEnd(7)} | ${String(r.accuracy).padEnd(3)} | ${String(r.insight).padEnd(3)} | ${String(r.actionable).padEnd(3)} | ${String(r.structure).padEnd(3)} | ${String(r.avgTotal).padEnd(5)}${star}| ${r.avgLatencyMs}ms`);
  }
  console.log(`\n## 推荐的 per-mode 温度 (Claude judge)`);
  for (const mode of MODES) {
    console.log(`  ${mode.padEnd(12)} → t=${bestByMode[mode].temp}  (score=${bestByMode[mode].score}/20)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

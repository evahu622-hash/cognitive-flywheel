/**
 * 对 run-temperature-eval 结果里 judge=null (失败) 的样本补跑 judge。
 * 不重跑生成,只补 judge,省钱省时间。
 *
 * 用法:
 *   npx tsx scripts/rejudge-temp-eval.ts scripts/temp-eval-results/{timestamp}/raw.json
 *
 * 输出:
 *   在原目录旁边生成 {timestamp}-rejudged/raw.json + summary.md
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { generateText } from "ai";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getModelByName } from "../src/lib/models";
import type { ThinkMode } from "../src/lib/think-prompts";

const JUDGE_MODEL_NAME = "minimax-fast";

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

const JUDGE_SYSTEM = `你是严格的 AI 评估专家。针对「认知飞轮」产品中思考模式的回答做打分。

评分维度 (每项 0-5 整数,5=最好,0=完全不满足):
1. accuracy (准确性): 事实是否正确,推断是否严谨 — 对 mirror/coach 尤其重要
2. insight (洞察深度): 是否提供非显而易见的真正价值,还是陈词滥调
3. actionable (可操作性): 建议是否能直接落地,有具体步骤/资源 — 对 coach 尤其重要
4. structure (结构性): 类比是否深层真正同构,而非表面相似 — 对 crossdomain 尤其重要

另外一个"json_valid"字段: true 如果生成的 JSON 结构符合该模式的 schema,false 如果缺字段/错字段。

输出严格 JSON (不要 markdown 代码块):
{
  "accuracy": 0-5,
  "insight": 0-5,
  "actionable": 0-5,
  "structure": 0-5,
  "json_valid": true | false,
  "comment": "一句话说明关键问题或亮点"
}`;

function buildJudgePrompt(mode: ThinkMode, question: string, rawAnswer: string, parsed: Record<string, unknown> | null) {
  return `模式: ${mode}
问题: ${question}

---- 模型原始输出 ----
${rawAnswer.slice(0, 6000)}

---- 解析后的 JSON ----
${parsed ? JSON.stringify(parsed).slice(0, 6000) : "(解析失败)"}

请按上述 5 项打分并输出 JSON。`;
}

interface JudgeScore {
  accuracy: number;
  insight: number;
  actionable: number;
  structure: number;
  json_valid: boolean;
  comment: string;
}

async function judgeOnce(mode: ThinkMode, question: string, rawAnswer: string, parsed: Record<string, unknown> | null, attempt = 1): Promise<JudgeScore | null> {
  try {
    const judgeModel = getModelByName(JUDGE_MODEL_NAME);
    const { text } = await generateText({
      model: judgeModel,
      system: JUDGE_SYSTEM,
      prompt: buildJudgePrompt(mode, question, rawAnswer, parsed),
      temperature: 0,
    });
    const parsedJudge = tryParseJson(text);
    if (!parsedJudge) return null;
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
    if (attempt < 3 && /负载|overload|503|rate/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 3000 * attempt));
      return judgeOnce(mode, question, rawAnswer, parsed, attempt + 1);
    }
    console.warn(`  judge error [attempt ${attempt}]: ${msg.slice(0, 100)}`);
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
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/rejudge-temp-eval.ts <path/to/raw.json>");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(inputPath, "utf-8")) as {
    generationModel: string;
    judgeModel: string;
    n: number;
    results: SampleResult[];
  };

  const needsRejudge = data.results.filter((r) => r.judge === null && r.rawAnswer);
  console.log(`\n=== Rejudge failed samples ===`);
  console.log(`Source: ${inputPath}`);
  console.log(`Total samples: ${data.results.length}`);
  console.log(`Needs rejudge: ${needsRejudge.length}`);
  console.log(`Judge model: ${JUDGE_MODEL_NAME}\n`);

  let idx = 0;
  let success = 0;
  let stillFail = 0;
  for (const r of needsRejudge) {
    idx++;
    process.stdout.write(`[${idx}/${needsRejudge.length}] ${r.mode} t=${r.temperature} ... `);
    const judge = await judgeOnce(r.mode, r.question, r.rawAnswer, r.parsed);
    if (judge) {
      r.judge = judge;
      success++;
      console.log(`acc=${judge.accuracy} ins=${judge.insight} act=${judge.actionable} str=${judge.structure}`);
    } else {
      stillFail++;
      console.log(`STILL_FAIL`);
    }
  }
  console.log(`\nRejudge: ${success} ok, ${stillFail} still failed`);

  // ── Aggregate (copy of logic in run-temperature-eval) ───────
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
  for (const r of data.results) {
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
    const judgedN = data.results.filter((r) => r.mode === mode && r.temperature === Number(tempStr) && r.judge).length;
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

  // ── Output ────────────────────────────────────────
  const outDir = path.dirname(inputPath) + "-rejudged";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "raw.json"), JSON.stringify({ ...data, judgeModel: JUDGE_MODEL_NAME, rows, bestByMode }, null, 2), "utf-8");

  let md = `# Temperature A/B Eval Summary (rejudged)\n\n`;
  md += `- Source: \`${inputPath}\`\n`;
  md += `- Generation model: \`${data.generationModel}\`\n`;
  md += `- Judge model: \`${JUDGE_MODEL_NAME}\` (重新打分,原始判定已 merge)\n`;
  md += `- Questions per mode: ${data.n}\n`;
  md += `- Total generations: ${data.results.length}\n`;
  md += `- Rejudge: ${success} ok / ${stillFail} still failed\n\n`;

  md += `## 分数对比表 (每项 0-5, avgTotal 满分 20)\n\n`;
  md += `| mode | temp | parseOk | judgedN | jsonValid | accuracy | insight | actionable | structure | **avgTotal** | latency |\n`;
  md += `|------|------|---------|---------|-----------|----------|---------|------------|-----------|--------------|---------|\n`;
  for (const r of rows) {
    const star = bestByMode[r.mode].temp === r.temp ? " ★" : "";
    md += `| ${r.mode} | ${r.temp} | ${r.parseOk}/${r.count} | ${r.judgedN}/${r.count} | ${r.jsonValid}/${r.count} | ${r.accuracy} | ${r.insight} | ${r.actionable} | ${r.structure} | **${r.avgTotal}${star}** | ${r.avgLatencyMs}ms |\n`;
  }

  md += `\n## 推荐的 per-mode 温度\n\n`;
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
  console.log(`\n## 推荐的 per-mode 温度`);
  for (const mode of MODES) {
    console.log(`  ${mode.padEnd(12)} → t=${bestByMode[mode].temp}  (score=${bestByMode[mode].score}/20)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Temperature A/B eval for Think modes.
 *
 * 矩阵: 4 模式 × 4 温度 × N 问题 = 16 × N 次生成，另加 16 × N 次 judge 打分。
 * 默认 N=5 → 80 生成 + 80 judge。
 *
 * 生成模型: AI_HEAVY_MODEL (当前线上配置，默认 minimax-fast)
 * 评判模型: claude-haiku-4-5 (稳定便宜)
 *
 * 运行:
 *   npx dotenv -e .env.local -- npx tsx scripts/run-temperature-eval.mts
 *   npx dotenv -e .env.local -- npx tsx scripts/run-temperature-eval.mts -- --n 3   # 小样本试跑
 *
 * 输出:
 *   scripts/temp-eval-results/{timestamp}/raw.json        所有生成结果+judge分数
 *   scripts/temp-eval-results/{timestamp}/summary.md      对比表 + 推荐温度
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { generateText } from "ai";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getModel, getModelByName, getConfiguredModelName } from "../src/lib/models";
import { getThinkSystemPrompt, type ThinkMode } from "../src/lib/think-prompts";
// Inlined to avoid pulling tailwind-merge dep chain in ESM context
function cleanAIResponse(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// ─── 配置 ───────────────────────────────────────────
const TEMPERATURES = [0.3, 0.5, 0.8, 1.0];
// 只有 MINIMAX_API_KEY 可用,generation + judge 统一用 minimax-fast (M2.7-highspeed)。
// M2.7 full 集群拥塞严重,2026-04 已从项目中移除。
// 注:judge 和 generation 同供应商同模型,系统性偏差在各温度档间抵消,
// 关注相对差值而非绝对分。
const JUDGE_MODEL_NAME = "minimax-fast";
const N_PER_MODE = Number(process.env.TEMP_EVAL_N ?? process.argv.slice(2).find((a, i, arr) => arr[i - 1] === "--n") ?? 5);

// ─── 评估数据集 ──────────────────────────────────────
// 每个模式 5 个有代表性的真实问题，覆盖用户四大领域(投资/Agent/健康/一人公司)
const DATASET: Record<ThinkMode, string[]> = {
  roundtable: [
    "我有 50 万现金,在 2026 年这个时点要不要全仓美股科技股?",
    "AI Agent 创业方向,是做通用 Agent 平台还是深耕垂直行业,哪个更有机会?",
    "作为 30 岁的程序员,现在转做独立开发者 (indie hacker) 是好时机吗?",
    "我想做一个付费的知识付费产品,定价 99 元年费和 999 元年费哪种模式更健康?",
    "大公司稳定年薪 80 万 vs 早期创业公司期权+40 万,我该怎么选?",
  ],
  coach: [
    "我想系统学习量化投资,但完全不知道从哪里开始,我目前只会写 Python 和基础的 pandas。",
    "我想成为一名 AI Agent 开发工程师,但只有传统后端经验,该如何补齐能力?",
    "我 35 岁开始认真健身,想同时增肌减脂,但完全没有训练经验,怎么入门?",
    "我想做一人公司卖 SaaS,但没有做过销售也没做过 B 端,我该先补哪块?",
    "我读了很多投资书籍但实际操作时还是追涨杀跌,问题出在哪里?",
  ],
  crossdomain: [
    "如何让一个 5 人的小团队保持持续创新力而不陷入路径依赖?",
    "一个 Agent 系统中多个子 Agent 协作时经常陷入死循环,有什么跨领域思路能破局?",
    "做独立产品长期保持动力的系统性方法有哪些?",
    "如何设计一个让用户越用越离不开的知识管理产品?",
    "投资组合的风险分散和身体健康的抗脆弱性之间有什么深层相似?",
  ],
  mirror: [
    "我正犹豫是否要辞掉稳定的大厂工作全职创业,历史上有没有类似决策可以参考?",
    "我在一个快速增长但竞争残酷的赛道上,该选择加速扩张还是收缩聚焦?",
    "作为一个技术背景的创始人,要不要找一个非技术的联合创始人?",
    "我的独立产品达到月收入 1 万美金后遇到瓶颈,历史上 indie hackers 是怎么突破的?",
    "长期坚持一件事情(比如写作或投资)十年以上的人,都经历过什么共同的低谷?",
  ],
};

const MODES: ThinkMode[] = ["roundtable", "coach", "crossdomain", "mirror"];

// ─── JSON 解析 (复用 route.ts 里的宽松策略) ─────────────
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

// ─── Judge prompt ───────────────────────────────────
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

async function judgeOnce(mode: ThinkMode, question: string, rawAnswer: string, parsed: Record<string, unknown> | null): Promise<JudgeScore | null> {
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
    console.warn(`  judge error: ${(err as Error).message}`);
    return null;
  }
}

// ─── 主流程 ─────────────────────────────────────────
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

async function generateOnce(mode: ThinkMode, question: string, temperature: number): Promise<{ rawAnswer: string; latencyMs: number; genError?: string }> {
  const model = getModel("heavy");
  const systemPrompt = getThinkSystemPrompt(mode);
  const startedAt = Date.now();
  try {
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: question,
      temperature,
    });
    return { rawAnswer: text, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { rawAnswer: "", latencyMs: Date.now() - startedAt, genError: (err as Error).message };
  }
}

async function main() {
  const n = Math.min(N_PER_MODE, 5);
  const generationModel = getConfiguredModelName("heavy");
  console.log(`\n=== Temperature A/B Eval ===`);
  console.log(`Generation model: ${generationModel}`);
  console.log(`Judge model: ${JUDGE_MODEL_NAME}`);
  console.log(`Modes: ${MODES.join(", ")}`);
  console.log(`Temperatures: ${TEMPERATURES.join(", ")}`);
  console.log(`Questions per mode: ${n}`);
  console.log(`Total generations: ${MODES.length * TEMPERATURES.length * n}\n`);

  const results: SampleResult[] = [];
  let idx = 0;
  const total = MODES.length * TEMPERATURES.length * n;

  for (const mode of MODES) {
    for (const temperature of TEMPERATURES) {
      for (let i = 0; i < n; i++) {
        idx++;
        const question = DATASET[mode][i];
        const tag = `[${idx}/${total}] ${mode} t=${temperature} q${i + 1}`;
        process.stdout.write(`${tag} ... `);
        const { rawAnswer, latencyMs, genError } = await generateOnce(mode, question, temperature);
        const parsed = rawAnswer ? tryParseJson(rawAnswer) : null;
        const parseOk = parsed !== null;
        let judge: JudgeScore | null = null;
        if (rawAnswer) {
          judge = await judgeOnce(mode, question, rawAnswer, parsed);
        }
        results.push({
          mode,
          temperature,
          question,
          rawAnswer,
          parsed,
          parseOk,
          latencyMs,
          genError,
          judge,
        });
        if (genError) {
          console.log(`GEN_ERROR (${genError.slice(0, 80)})`);
        } else if (!judge) {
          console.log(`parse=${parseOk} judge=FAIL (${latencyMs}ms)`);
        } else {
          console.log(`parse=${parseOk} acc=${judge.accuracy} ins=${judge.insight} act=${judge.actionable} str=${judge.structure} (${latencyMs}ms)`);
        }
      }
    }
  }

  // ─── Aggregate ───────────────────────────────────
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
  for (const r of results) {
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

  // 计算均值
  const rows: Array<{ mode: ThinkMode; temp: number } & Agg & { avgTotal: number }> = [];
  for (const [key, b] of Object.entries(buckets)) {
    const [mode, tempStr] = key.split("|");
    const judged = results.filter((r) => r.mode === mode && r.temperature === Number(tempStr) && r.judge).length || 1;
    rows.push({
      mode: mode as ThinkMode,
      temp: Number(tempStr),
      count: b.count,
      parseOk: b.parseOk,
      jsonValid: b.jsonValid,
      avgLatencyMs: Math.round(b.avgLatencyMs / b.count),
      accuracy: +(b.accuracy / judged).toFixed(2),
      insight: +(b.insight / judged).toFixed(2),
      actionable: +(b.actionable / judged).toFixed(2),
      structure: +(b.structure / judged).toFixed(2),
      total: b.total,
      avgTotal: +(b.total / judged).toFixed(2),
    });
  }
  rows.sort((a, b) => (a.mode === b.mode ? a.temp - b.temp : a.mode.localeCompare(b.mode)));

  // 每个模式选最佳温度 (按 avgTotal)
  const bestByMode: Record<string, { temp: number; score: number }> = {};
  for (const r of rows) {
    const cur = bestByMode[r.mode];
    if (!cur || r.avgTotal > cur.score) {
      bestByMode[r.mode] = { temp: r.temp, score: r.avgTotal };
    }
  }

  // ─── 输出 ────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join("scripts", "temp-eval-results", ts);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "raw.json"), JSON.stringify({ generationModel, judgeModel: JUDGE_MODEL_NAME, n, results, rows, bestByMode }, null, 2), "utf-8");

  let md = `# Temperature A/B Eval Summary\n\n`;
  md += `- Timestamp: ${ts}\n`;
  md += `- Generation model: \`${generationModel}\`\n`;
  md += `- Judge model: \`${JUDGE_MODEL_NAME}\`\n`;
  md += `- Questions per mode: ${n}\n`;
  md += `- Total generations: ${results.length}\n\n`;

  md += `## 分数对比表 (每项 0-5, avgTotal 满分 20)\n\n`;
  md += `| mode | temp | parseOk | jsonValid | accuracy | insight | actionable | structure | **avgTotal** | latency |\n`;
  md += `|------|------|---------|-----------|----------|---------|------------|-----------|--------------|---------|\n`;
  for (const r of rows) {
    const star = bestByMode[r.mode].temp === r.temp ? "★" : "";
    md += `| ${r.mode} | ${r.temp} | ${r.parseOk}/${r.count} | ${r.jsonValid}/${r.count} | ${r.accuracy} | ${r.insight} | ${r.actionable} | ${r.structure} | **${r.avgTotal}${star}** | ${r.avgLatencyMs}ms |\n`;
  }

  md += `\n## 推荐的 per-mode 温度\n\n`;
  md += `| mode | 推荐温度 | 得分 |\n`;
  md += `|------|----------|------|\n`;
  for (const mode of MODES) {
    md += `| ${mode} | ${bestByMode[mode].temp} | ${bestByMode[mode].score} |\n`;
  }

  md += `\n## 原始结果存档\n\n\`raw.json\` 保存了每条生成的完整输出、解析状态、judge 分数与评语,便于人工抽查。\n`;

  writeFileSync(path.join(outDir, "summary.md"), md, "utf-8");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`结果写入: ${outDir}`);
  console.log(`\n## 对比表\n`);
  console.log(`mode        | temp | parseOk | acc | ins | act | str | total | latency`);
  console.log(`------------|------|---------|-----|-----|-----|-----|-------|--------`);
  for (const r of rows) {
    const star = bestByMode[r.mode].temp === r.temp ? " ★" : "  ";
    console.log(`${r.mode.padEnd(11)} | ${String(r.temp).padEnd(4)} | ${(`${r.parseOk}/${r.count}`).padEnd(7)} | ${String(r.accuracy).padEnd(3)} | ${String(r.insight).padEnd(3)} | ${String(r.actionable).padEnd(3)} | ${String(r.structure).padEnd(3)} | ${String(r.avgTotal).padEnd(5)}${star}| ${r.avgLatencyMs}ms`);
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

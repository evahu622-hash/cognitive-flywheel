// Mirror 模式专用 pipeline: LLM 候选 + Wikipedia 事实锚点
// 为 route.ts 提供 buildMirrorWikiContext(),让 mirror 模式不再依赖 LLM 预训练记忆

import { generateText } from "ai";
import { getModel } from "./models";
import { cleanAIResponse } from "./utils";
import {
  fetchWikipediaFigures,
  type WikipediaFigure,
} from "./wikipedia";

export interface MirrorCandidate {
  name: string;
  era: string;
  reason: string;
}

export interface MirrorWikiContext {
  /** LLM 提议的候选人物 */
  candidates: MirrorCandidate[];
  /** 成功命中 Wikipedia 的人物 (含事实 extract 与 canonical URL) */
  figures: WikipediaFigure[];
  /** 候选里 Wikipedia 查不到的名字 */
  unmatched: string[];
  /** 直接注入 system prompt 的事实文本块 (空字符串表示无事实锚点可用) */
  promptText: string;
  /** Phase 1 LLM 调用是否成功 */
  candidateLLMCallOk: boolean;
  /** Phase 2 Wikipedia 至少命中 1 条 */
  wikiFetchOk: boolean;
  /** 降级原因 (null 表示正常) */
  errorMessage: string | null;
}

const CANDIDATE_SYSTEM_PROMPT = `你的任务是针对用户问题，推荐 3 位历史上面临过结构性相似困境的真实人物。

## 规则
1. 必须是有据可查的真实人物（历史或现代），不要虚构
2. **优先选择在 Wikipedia 上有独立词条的知名人物** —— 后续会自动拉取 Wikipedia 资料
3. 3 个人物要来自不同时代或文化，提供多样视角
4. 困境必须与用户问题**结构性相似**，不是表面相似
5. 名字用 Wikipedia 最可能收录的形式（中文人物用中文名，外国人物可用中文译名或英文原名）

## 输出格式（严格 JSON，不要 markdown 代码块）
{
  "candidates": [
    {"name": "人物名", "era": "时代或生卒年", "reason": "一句话说明为什么他/她的困境与此问题结构相似"},
    {"name": "人物名", "era": "时代或生卒年", "reason": "..."},
    {"name": "人物名", "era": "时代或生卒年", "reason": "..."}
  ]
}`;

async function pickCandidatesWithLLM(
  question: string,
  knowledgeContext: string
): Promise<{
  candidates: MirrorCandidate[];
  error: string | null;
}> {
  const contextSection = knowledgeContext
    ? `\n\n## 用户的知识库上下文（仅作为灵感，不是必须引用）\n${knowledgeContext}`
    : "";

  try {
    const model = getModel("light");
    const { text } = await generateText({
      model,
      system: CANDIDATE_SYSTEM_PROMPT + contextSection,
      prompt: question,
      temperature: 0.4, // 低一点保证人物选择稳定
    });
    const cleaned = cleanAIResponse(text);

    let parsed: { candidates?: unknown };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return {
          candidates: [],
          error: "候选 LLM 返回非 JSON",
        };
      }
      parsed = JSON.parse(match[0]);
    }

    const raw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const candidates: MirrorCandidate[] = raw
      .filter(
        (c: unknown): c is MirrorCandidate =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as MirrorCandidate).name === "string" &&
          (c as MirrorCandidate).name.trim().length > 0
      )
      .slice(0, 3)
      .map((c) => ({
        name: c.name.trim(),
        era: typeof c.era === "string" ? c.era : "",
        reason: typeof c.reason === "string" ? c.reason : "",
      }));

    return { candidates, error: null };
  } catch (err) {
    return {
      candidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildWikiPromptText(
  figures: WikipediaFigure[],
  candidates: MirrorCandidate[]
): string {
  if (figures.length === 0) return "";

  const lines: string[] = [
    "## Wikipedia 事实锚点（mirror 模式专用）",
    "",
    "下面是从 Wikipedia 拉取的真实人物词条。你的 `story` 字段**必须严格基于这些摘录中的事实**，不要补充摘录里没有的年份、事件、数字或引语。",
    "",
  ];
  for (const fig of figures) {
    const cand = candidates.find((c) => c.name === fig.queryName);
    lines.push(`### ${fig.title} (Wikipedia ${fig.lang})`);
    if (cand?.reason) {
      lines.push(`**与用户问题的结构相似点**: ${cand.reason}`);
    }
    lines.push(`**来源 URL**: ${fig.url}`);
    lines.push(`**Wikipedia 摘录**:`);
    lines.push(fig.extract);
    lines.push("");
  }
  return lines.join("\n");
}

export type MirrorPipelinePhase = "candidates" | "wikipedia";

/**
 * mirror 模式的 2-phase pipeline:
 *   Phase 1: light LLM 从用户问题推荐 3 位候选人
 *   Phase 2: 并行拉取每人的 Wikipedia 摘录
 *
 * 任意一步失败都返回空的 promptText,上层 route.ts 会自动降级到
 * 原有纯 LLM 路径。candidateLLMCallOk / wikiFetchOk 字段给出诊断信号。
 *
 * onProgress 回调在 Phase 2 开始前被调用一次 (Phase 1 在函数调用时即开始),
 * 方便上层发送 SSE 进度事件。
 */
export async function buildMirrorWikiContext(
  question: string,
  knowledgeContext: string,
  onProgress?: (phase: MirrorPipelinePhase) => void
): Promise<MirrorWikiContext> {
  onProgress?.("candidates");
  const { candidates, error: candidateError } = await pickCandidatesWithLLM(
    question,
    knowledgeContext
  );

  if (candidateError || candidates.length === 0) {
    return {
      candidates,
      figures: [],
      unmatched: candidates.map((c) => c.name),
      promptText: "",
      candidateLLMCallOk: candidateError === null,
      wikiFetchOk: false,
      errorMessage: candidateError,
    };
  }

  onProgress?.("wikipedia");
  const fetched = await fetchWikipediaFigures(
    candidates.map((c) => c.name),
    { preferLang: "zh" }
  );

  const figures: WikipediaFigure[] = [];
  const unmatched: string[] = [];
  for (const item of fetched) {
    if (item.figure) {
      figures.push(item.figure);
    } else {
      unmatched.push(item.queryName);
    }
  }

  return {
    candidates,
    figures,
    unmatched,
    promptText: buildWikiPromptText(figures, candidates),
    candidateLLMCallOk: true,
    wikiFetchOk: figures.length > 0,
    errorMessage: null,
  };
}

/**
 * 在 heavy LLM 生成结果后,用 Wikipedia 真实 URL 强制覆盖/注入 figures[i].wikipedia_url
 * 做名字模糊匹配,避免 LLM 胡写或漏写 URL
 */
export function overrideFigureUrls(
  result: Record<string, unknown>,
  wikiFigures: WikipediaFigure[]
): Record<string, unknown> {
  if (wikiFigures.length === 0) return result;
  if (!Array.isArray(result.figures)) return result;

  const normalized = wikiFigures.map((f) => ({
    canonicalTitle: f.title,
    queryName: f.queryName,
    url: f.url,
    // 用于模糊匹配的 token 集合
    tokens: new Set(
      [f.title, f.queryName]
        .join("|")
        .toLowerCase()
        .split(/[|\s·.,\-()（）]+/)
        .filter((t) => t.length >= 2)
    ),
  }));

  const patchedFigures = (result.figures as Array<Record<string, unknown>>).map(
    (figure) => {
      const name = typeof figure.name === "string" ? figure.name : "";
      if (!name) return figure;

      const nameTokens = name
        .toLowerCase()
        .split(/[|\s·.,\-()（）]+/)
        .filter((t) => t.length >= 2);

      // 找重合度最高的 wiki figure
      let bestMatch: (typeof normalized)[number] | null = null;
      let bestScore = 0;
      for (const wf of normalized) {
        let score = 0;
        for (const t of nameTokens) {
          if (wf.tokens.has(t)) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMatch = wf;
        }
      }

      if (bestMatch && bestScore > 0) {
        return { ...figure, wikipedia_url: bestMatch.url };
      }
      // 没匹配上就保留 LLM 的原值(可能是 undefined)
      return figure;
    }
  );

  return { ...result, figures: patchedFigures };
}

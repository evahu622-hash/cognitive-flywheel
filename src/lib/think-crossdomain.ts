// Crossdomain 模式专用 grounding pipeline:
//   Phase 1: light LLM 提议 3 个候选领域 + 每个领域 1-2 个搜索关键词
//   Phase 2: 并行调用 MiniMax search 拉取每个关键词的真实素材
//   Phase 3: 按领域分组拼成 system prompt 注入块
//
// 目的: 让 crossdomain 能引用真实的科学研究、案例、最新发展,
//       而不是 LLM 半记半编的"约莫记得有这么个 XX"

import { generateText } from "ai";
import { getModel } from "./models";
import { cleanAIResponse } from "./utils";
import {
  searchMinimax,
  type MinimaxOrganicResult,
} from "./minimax-search";

export interface CrossdomainCandidate {
  /** 显示用领域名,带 emoji */
  domain: string;
  /** 1-2 个搜索关键词 */
  queries: string[];
  /** 为什么这个领域和用户问题结构相似 */
  reason: string;
}

export interface CrossdomainSearchedItem extends MinimaxOrganicResult {
  /** 全局编号,用于 prompt 中 [N] 引用 */
  index: number;
  /** 来自哪个领域 */
  domain: string;
  /** 来自哪个 query */
  query: string;
}

export interface CrossdomainWebContext {
  candidates: CrossdomainCandidate[];
  /** 所有领域的素材,展平 + 全局编号 */
  items: CrossdomainSearchedItem[];
  promptText: string;
  candidateLLMCallOk: boolean;
  searchOk: boolean;
  errorMessage: string | null;
}

export type CrossdomainPipelinePhase = "candidates" | "search";

const CANDIDATES_SYSTEM_PROMPT = `你是「跨域连接」模式的素材准备阶段。你的任务是针对用户问题,提议 3 个**与问题领域差异最大**的候选领域,以及每个领域 1-2 个真实可搜的关键词。这些关键词随后会被自动 web search,把真实研究/案例/新闻拉回来作为后续 LLM 写类比的素材。

## 规则
1. 选 3 个**差异最大**的领域(如:生物学、音乐、军事、建筑、考古、经济学、物理学、心理学、体育、医学、艺术…)
2. 每个领域提供 1-2 个**具体可搜**的关键词(包含人名/术语/期刊/案例),不要写"X 的基础理论"这种泛泛词
3. 关键词应该指向**有真实研究或案例**的具体现象,而不是大众都知道的常识
4. 不同领域之间的关键词不要重复主题
5. 避开和用户问题字面相似的关键词——要找**结构性相似但表面无关**的事物

## 输出格式(严格 JSON,无 markdown)
{
  "candidates": [
    {
      "domain": "🧬 生物学",
      "queries": ["免疫系统 V(D)J 重组 抗体多样性", "蜜蜂 群体决策 摇摆舞"],
      "reason": "免疫系统的多样性生成机制与团队创新的探索 vs 利用权衡结构相似"
    },
    {
      "domain": "🏗️ 建筑学",
      "queries": ["哥特式 飞扶壁 结构创新"],
      "reason": "..."
    },
    {
      "domain": "⚾ 体育",
      "queries": ["Moneyball 数据棒球 Beane"],
      "reason": "..."
    }
  ]
}`;

async function pickCandidatesWithLLM(
  question: string,
  knowledgeContext: string
): Promise<{ candidates: CrossdomainCandidate[]; error: string | null }> {
  const contextSection = knowledgeContext
    ? `\n\n## 用户的知识库上下文(仅作灵感)\n${knowledgeContext}`
    : "";

  try {
    const model = getModel("light");
    const { text } = await generateText({
      model,
      system: CANDIDATES_SYSTEM_PROMPT + contextSection,
      prompt: question,
      temperature: 0.6, // 高一点鼓励多样领域选择
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
          error: "Crossdomain candidates LLM 返回非 JSON",
        };
      }
      parsed = JSON.parse(match[0]);
    }

    const raw = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const candidates: CrossdomainCandidate[] = raw
      .filter(
        (c: unknown): c is CrossdomainCandidate =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as CrossdomainCandidate).domain === "string" &&
          Array.isArray((c as CrossdomainCandidate).queries) &&
          (c as CrossdomainCandidate).queries.length > 0
      )
      .slice(0, 3)
      .map((c) => ({
        domain: c.domain.trim(),
        queries: c.queries
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .slice(0, 2)
          .map((q) => q.trim()),
        reason: typeof c.reason === "string" ? c.reason : "",
      }))
      .filter((c) => c.queries.length > 0);

    return { candidates, error: null };
  } catch (e) {
    return {
      candidates: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildPromptText(
  candidates: CrossdomainCandidate[],
  items: CrossdomainSearchedItem[]
): string {
  if (items.length === 0) return "";

  const lines: string[] = [
    "## 跨域真实素材库(crossdomain 模式专用 grounding)",
    "",
    "下面是从公开网络拉取到的 3 个领域的真实研究/案例/新闻片段。**你写的每个 connection.content 中,引用具体事实/数字/人名时必须用 `[N]` 编号溯源到下方素材**。如果某个细节不在素材里,要么不写,要么用\"据相关研究\"软化。**严禁补充素材中没有的具体细节(如年份、期刊、作者)**。",
    "",
  ];

  const byDomain = new Map<string, CrossdomainSearchedItem[]>();
  for (const item of items) {
    const arr = byDomain.get(item.domain) ?? [];
    arr.push(item);
    byDomain.set(item.domain, arr);
  }

  for (const cand of candidates) {
    const domainItems = byDomain.get(cand.domain) ?? [];
    if (domainItems.length === 0) continue;
    lines.push(`### ${cand.domain}`);
    if (cand.reason) lines.push(`(结构相似点: ${cand.reason})`);
    for (const item of domainItems) {
      const dateBit = item.date ? ` (${item.date})` : "";
      lines.push(`[${item.index}] **${item.title}**${dateBit}`);
      lines.push(
        `    ${item.snippet.slice(0, 220)}${item.snippet.length > 220 ? "…" : ""}`
      );
      lines.push(`    URL: ${item.link}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Crossdomain 模式 2-phase grounding pipeline.
 * 任何一步失败 → promptText="",上层降级到原始 prompt。
 */
export async function buildCrossdomainWebContext(
  question: string,
  knowledgeContext: string,
  onProgress?: (phase: CrossdomainPipelinePhase) => void
): Promise<CrossdomainWebContext> {
  onProgress?.("candidates");
  const { candidates, error } = await pickCandidatesWithLLM(
    question,
    knowledgeContext
  );

  if (error || candidates.length === 0) {
    return {
      candidates,
      items: [],
      promptText: "",
      candidateLLMCallOk: error === null,
      searchOk: false,
      errorMessage: error,
    };
  }

  onProgress?.("search");
  // 把所有 (domain, query) 拍平后并行,limit=3 控制总量
  const allTasks: Array<{ domain: string; query: string }> = [];
  for (const c of candidates) {
    for (const q of c.queries) {
      allTasks.push({ domain: c.domain, query: q });
    }
  }

  const searchResults = await Promise.all(
    allTasks.map((t) => searchMinimax(t.query, { limit: 3 }))
  );

  const items: CrossdomainSearchedItem[] = [];
  let nextIndex = 1;
  for (let i = 0; i < allTasks.length; i++) {
    const task = allTasks[i];
    const result = searchResults[i];
    if (!result || result.results.length === 0) continue;
    for (const r of result.results) {
      items.push({
        ...r,
        index: nextIndex++,
        domain: task.domain,
        query: task.query,
      });
    }
  }

  return {
    candidates,
    items,
    promptText: buildPromptText(candidates, items),
    candidateLLMCallOk: true,
    searchOk: items.length > 0,
    errorMessage: null,
  };
}

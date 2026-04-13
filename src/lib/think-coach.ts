// Coach 模式专用 grounding pipeline:
//   Phase 1: light LLM 从问题中抽取 4-6 个"学习主题候选"
//   Phase 2: 并行调用 MiniMax search 验证每个主题真实存在的资源
//   Phase 3: 拼成 system prompt 注入块
//
// 目的: 防止 coach 模式幻觉出不存在的书/课/工具

import { generateText } from "ai";
import { getModel } from "./models";
import { cleanAIResponse } from "./utils";
import {
  searchMinimax,
  type MinimaxOrganicResult,
} from "./minimax-search";

export interface CoachTopic {
  /** 主题简短名称，用于 LLM 内部分组 */
  name: string;
  /** 实际拿去搜索的关键词，应包含书名/作者/课程平台等线索 */
  query: string;
  /** 这个主题为什么和用户问题相关 */
  reason: string;
}

export interface CoachSearchedResource extends MinimaxOrganicResult {
  /** 全局编号 (1, 2, 3...), 用于 prompt 中 [N] 引用 */
  index: number;
  /** 来自哪个 topic */
  topicName: string;
}

export interface CoachWebContext {
  /** Phase 1 推断出的学习主题 */
  topics: CoachTopic[];
  /** Phase 2 拉到的所有可用资源 (展平 + 编号) */
  resources: CoachSearchedResource[];
  /** 拼好的 system prompt 注入文本 (空字符串=没拿到任何资源) */
  promptText: string;
  /** Phase 1 LLM 调用是否成功 */
  candidateLLMCallOk: boolean;
  /** Phase 2 至少命中 1 条 */
  searchOk: boolean;
  /** 降级原因 (null=正常) */
  errorMessage: string | null;
}

export type CoachPipelinePhase = "topics" | "search";

const TOPICS_SYSTEM_PROMPT = `你是「认知教练」的资源准备阶段。针对用户问题,你的任务是抽取 4-6 个具体的学习主题,这些主题随后会被自动用 web search 验证是否存在真实资源。

## 规则
1. 主题要**具体可搜**(包含关键词、技术名、人物名、产品名),不要写"学习一些 X 的基础"这种模糊词
2. 主题要覆盖**多种资源类型**:论文 / 框架 / 工具 / 课程 / 书 / 文档 / 案例
3. 一个主题对应**一次 web search**, query 字段就是真实搜索词,字数不要太长
4. 优先选择"用户最可能不知道但应该知道"的资源,而不是"老生常谈的入门"
5. 如果提供了用户的知识库上下文,主题要避开已经明显掌握的内容,聚焦盲区

## 输出格式(严格 JSON,无 markdown)
{
  "topics": [
    {"name": "MemGPT 论文", "query": "MemGPT paper Berkeley long-term memory", "reason": "用户提到 agent memory,这是该领域奠基论文"},
    {"name": "LangGraph 文档", "query": "LangGraph official documentation tutorial", "reason": "..."},
    ...
  ]
}`;

async function pickTopicsWithLLM(
  question: string,
  knowledgeContext: string
): Promise<{ topics: CoachTopic[]; error: string | null }> {
  const contextSection = knowledgeContext
    ? `\n\n## 用户的知识库上下文(用于识别盲区)\n${knowledgeContext}`
    : "";

  try {
    const model = getModel("light");
    const { text } = await generateText({
      model,
      system: TOPICS_SYSTEM_PROMPT + contextSection,
      prompt: question,
      temperature: 0.4,
    });
    const cleaned = cleanAIResponse(text);

    let parsed: { topics?: unknown };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) {
        return { topics: [], error: "Coach topics LLM 返回非 JSON" };
      }
      parsed = JSON.parse(match[0]);
    }

    const raw = Array.isArray(parsed.topics) ? parsed.topics : [];
    const topics: CoachTopic[] = raw
      .filter(
        (t: unknown): t is CoachTopic =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as CoachTopic).query === "string" &&
          (t as CoachTopic).query.trim().length > 0
      )
      .slice(0, 6)
      .map((t) => ({
        name:
          typeof t.name === "string" && t.name.trim() ? t.name.trim() : t.query,
        query: t.query.trim(),
        reason: typeof t.reason === "string" ? t.reason : "",
      }));

    return { topics, error: null };
  } catch (e) {
    return {
      topics: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function buildPromptText(
  topics: CoachTopic[],
  resources: CoachSearchedResource[]
): string {
  if (resources.length === 0) return "";

  const lines: string[] = [
    "## 已验证的真实学习资源(coach 模式专用 grounding)",
    "",
    "下面是通过 web search 拉取到的真实资源,**你的 `blindSpots[].suggestion` 和 `learningPath[].task` 字段中提到的所有书/论文/课程/工具,必须只能从这个列表里选**,并在文中用 `[N]` 编号引用。**严禁推荐没有出现在这个列表里的资源**——如果列表覆盖不到的领域,就说\"建议自行检索 X 关键词\",而不是凭记忆编书名。",
    "",
  ];

  // 按 topic 分组展示,但编号是全局唯一的
  const byTopic = new Map<string, CoachSearchedResource[]>();
  for (const r of resources) {
    const arr = byTopic.get(r.topicName) ?? [];
    arr.push(r);
    byTopic.set(r.topicName, arr);
  }

  for (const topic of topics) {
    const items = byTopic.get(topic.name) ?? [];
    if (items.length === 0) continue;
    lines.push(`### 主题: ${topic.name}`);
    if (topic.reason) lines.push(`(为何相关: ${topic.reason})`);
    for (const item of items) {
      const dateBit = item.date ? ` (${item.date})` : "";
      lines.push(`[${item.index}] **${item.title}**${dateBit}`);
      lines.push(`    ${item.snippet.slice(0, 220)}${item.snippet.length > 220 ? "…" : ""}`);
      lines.push(`    URL: ${item.link}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Coach 模式 2-phase grounding pipeline.
 * 任何一步失败 → 返回空 promptText,上层走原始无 grounding 路径。
 */
export async function buildCoachWebContext(
  question: string,
  knowledgeContext: string,
  onProgress?: (phase: CoachPipelinePhase) => void
): Promise<CoachWebContext> {
  onProgress?.("topics");
  const { topics, error: topicsError } = await pickTopicsWithLLM(
    question,
    knowledgeContext
  );

  if (topicsError || topics.length === 0) {
    return {
      topics,
      resources: [],
      promptText: "",
      candidateLLMCallOk: topicsError === null,
      searchOk: false,
      errorMessage: topicsError,
    };
  }

  onProgress?.("search");
  // 每个 topic 拉 4 条,总数控制在 4*6=24 上限内
  const searchResults = await Promise.all(
    topics.map((t) => searchMinimax(t.query, { limit: 4 }))
  );

  const resources: CoachSearchedResource[] = [];
  let nextIndex = 1;
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const result = searchResults[i];
    if (!result || result.results.length === 0) continue;
    for (const item of result.results) {
      resources.push({
        ...item,
        index: nextIndex++,
        topicName: topic.name,
      });
    }
  }

  return {
    topics,
    resources,
    promptText: buildPromptText(topics, resources),
    candidateLLMCallOk: true,
    searchOk: resources.length > 0,
    errorMessage: null,
  };
}

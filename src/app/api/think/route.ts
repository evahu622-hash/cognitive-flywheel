import { generateText } from "ai";
import { getConfiguredModelName, getModel } from "@/lib/models";
import { cleanAIResponse } from "@/lib/utils";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Database, Json } from "@/lib/database.types";
import {
  buildKnowledgeContextText,
  createEvalTrace,
  PROMPT_VERSIONS,
  runEvalSpan,
  toJson,
  updateEvalTrace,
} from "@/lib/evals";
import { runCodeEvaluatorsForTrace } from "@/lib/evaluators";
import { isEmbeddingConfigured } from "@/lib/embeddings";
import {
  searchKnowledge,
  summarizeRetrievalSources,
  type RetrievedKnowledgeItem,
} from "@/lib/retrieval";

// ============================================================
// POST /api/think — 四大思考模式 API
// SSE 流式响应：阶段进度 + 结构化结果
// ============================================================

interface ThinkRequest {
  mode: "roundtable" | "coach" | "crossdomain" | "mirror";
  question: string;
  context?: string; // 未来从记忆层检索的上下文
}

function buildContextPreviewItems(items: RetrievedKnowledgeItem[]) {
  return items.slice(0, 6).map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary.slice(0, 200),
    domain: item.domain,
    tags: item.tags.slice(0, 6),
    retrieval_source: item.retrieval_source,
  }));
}

// 各模式的思考阶段动画
const PHASES: Record<string, string[]> = {
  roundtable: [
    "分析你的问题...",
    "召集专家团...",
    "多视角深度讨论中...",
    "提炼关键洞察...",
  ],
  coach: [
    "分析你的认知状态...",
    "扫描知识盲区...",
    "生成诊断报告...",
    "规划学习路径...",
  ],
  crossdomain: [
    "搜索跨领域知识库...",
    "寻找结构性类比...",
    "建立跨域关联...",
    "提炼可迁移的洞察...",
  ],
  mirror: [
    "搜索历史先驱...",
    "匹配相似困境...",
    "深入历史案例...",
    "提炼历史智慧...",
  ],
};

// 各模式的系统提示词
function getSystemPrompt(mode: string, context?: string): string {
  const contextSection = context
    ? `\n\n## 用户的知识库上下文（来自记忆层）\n${context}`
    : "";

  switch (mode) {
    case "roundtable":
      return `你是认知飞轮的「圆桌会议」引擎。你的任务是以多位真实专家的视角来分析用户的问题。

## 规则
1. 选择 3 位与问题最相关的真实历史人物或当代思想家。只使用可验证的真实人物，不确定是否真实存在的人不要使用
2. 每位专家必须提供与其他人不同甚至冲突的观点
3. 专家的发言必须符合其本人的思维风格和已知观点
4. 如果提供了知识库上下文，专家分析中必须明确引用上下文里的具体信息（如"根据你此前关于…的笔记""你之前记录的…"），让用户能看到上下文对分析的实质影响
5. 在证据不充分时使用"可能""一种观点认为"等措辞，不要把推断说成定论
6. 最后提炼出可行的关键洞察

## 输出格式（严格JSON，不要markdown代码块）
{
  "experts": [
    {"name": "专家名", "avatar": "单个emoji", "tag": "一句话身份描述", "content": "专家的深度分析，200-300字，必须有具体建议"},
    {"name": "专家名", "avatar": "单个emoji", "tag": "一句话身份描述", "content": "不同视角的分析"},
    {"name": "专家名", "avatar": "单个emoji", "tag": "一句话身份描述", "content": "第三个视角"}
  ],
  "insights": ["洞察1：具体可行的建议", "洞察2", "洞察3", "洞察4"]
}${contextSection}`;

    case "coach":
      return `你是认知飞轮的「认知教练」。你的任务是分析用户的问题，发现其知识盲区，并生成个性化学习路径。

## 规则
1. 从问题本身推断用户的认知水平和可能的盲区
2. 盲区要具体可操作，不要泛泛而谈
3. 学习路径要有时间节点和具体资源（书名、课程、实践方法）
4. 既要指出不足，也要肯定优势
5. 如果提供了知识库上下文，必须基于上下文中的具体信息来判断优势和盲区（如"从你关于…的笔记来看"），而非仅凭通用推断
6. 建议中使用"建议考虑""可能有帮助"等措辞，避免武断的绝对化表述

## 输出格式（严格JSON）
{
  "strengths": ["优势1", "优势2", "优势3"],
  "blindSpots": [
    {"area": "盲区名称", "severity": "high/medium/low", "detail": "具体描述为什么这是盲区", "suggestion": "具体的学习建议，包括书名或资源"}
  ],
  "learningPath": [
    {"week": "本周", "task": "具体任务", "priority": "高/中/低"},
    {"week": "下周", "task": "具体任务", "priority": "高/中/低"},
    {"week": "第3周", "task": "具体任务", "priority": "高/中/低"},
    {"week": "第4周", "task": "具体任务", "priority": "高/中/低"}
  ],
  "insights": ["关键洞察1", "关键洞察2", "关键洞察3"]
}${contextSection}`;

    case "crossdomain":
      return `你是认知飞轮的「跨域连接器」。你的任务是从完全不同的领域找到与用户问题结构性相似的概念，建立深度类比。

## 规则
1. 选择 3 个差异最大的领域（如：生物学、音乐、军事、建筑、经济学、物理学、心理学、体育等）
2. 类比必须是结构性的（不是表面相似），要解释深层逻辑为什么一样
3. 每个类比必须给出具体的操作映射：说明 A 中的什么机制与 B 中的什么机制对应，以及如何操作
4. 类比要让人有"啊哈！"的惊喜感，不要停留在"XX和YY都很重要"的抽象层面
5. 如果提供了知识库上下文，必须结合上下文中的具体知识来丰富类比

## 输出格式（严格JSON）
{
  "connections": [
    {"domain": "emoji + 领域名", "title": "A ≈ B 的类比标题", "content": "200-300字的深度类比分析，包含具体的可操作启发"},
    {"domain": "emoji + 领域名", "title": "类比标题", "content": "分析"},
    {"domain": "emoji + 领域名", "title": "类比标题", "content": "分析"}
  ],
  "insights": ["核心洞察1", "核心洞察2", "核心洞察3"]
}${contextSection}`;

    case "mirror":
      return `你是认知飞轮的「历史镜鉴」引擎。你的任务是找到历史上面临过类似困境的先驱，分析他们的选择和智慧。

## 规则
1. 选择 3 位历史人物（可以跨越不同时代和文化），必须是有据可查的真实人物
2. 他们面临的困境必须与用户的问题有结构性相似
3. 要讲清楚他们做了什么选择、结果如何、我们可以学到什么
4. 历史事实要准确，不要编造；具体数字（年份、数量）必须有确信度，不确定时用"约"或"据记载"修饰
5. 如果提供了知识库上下文，教训部分要结合上下文中的具体信息，使分析对用户更有针对性

## 输出格式（严格JSON）
{
  "figures": [
    {"name": "人物名", "avatar": "单个emoji", "period": "时代", "story": "300字的故事：面临的困境、做出的选择、结果如何", "lesson": "一句话总结的教训"},
    {"name": "人物名", "avatar": "单个emoji", "period": "时代", "story": "故事", "lesson": "教训"},
    {"name": "人物名", "avatar": "单个emoji", "period": "时代", "story": "故事", "lesson": "教训"}
  ],
  "insights": ["历史智慧1", "历史智慧2", "历史智慧3"]
}${contextSection}`;

    default:
      return "分析用户的问题并给出深度回答。";
  }
}

async function parseThinkResult(
  mode: ThinkRequest["mode"],
  systemPrompt: string,
  rawText: string
) {
  const cleaned = cleanAIResponse(rawText);

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      } catch {
        // Fall through to repair.
      }
    }
  }

  const repairModel = getModel("light");
  const repairResponse = await generateText({
    model: repairModel,
    system: `${systemPrompt}\n\n你现在是 JSON 修复器。你的唯一任务是把已有内容修复成严格合法的 JSON。不要补充解释，不要输出 markdown 代码块。`,
    prompt: `请把下面这段输出修复成合法 JSON，保持原意，字段必须符合当前模式 ${mode} 的 schema。\n\n${cleaned}`,
    temperature: 0,
  });

  const repaired = cleanAIResponse(repairResponse.text);

  try {
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    const repairedMatch = repaired.match(/\{[\s\S]*\}/);
    if (repairedMatch) {
      return JSON.parse(repairedMatch[0]) as Record<string, unknown>;
    }
    throw new Error("AI 返回格式错误，无法解析");
  }
}

export async function POST(req: Request) {
  const requestStartedAtMs = Date.now();
  const { mode, question, context } = (await req.json()) as ThinkRequest;

  if (!question?.trim()) {
    return Response.json({ error: "请输入问题" }, { status: 400 });
  }

  // 检查是否有可用的 AI 模型
  const hasAI =
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.MINIMAX_API_KEY;

  if (!hasAI) {
    return Response.json({ mode: "demo" });
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hasEmbedding = isEmbeddingConfigured();
  const modelName = getConfiguredModelName("heavy");
  const traceId = await createEvalTrace({
    supabase,
    userId: user.id,
    entryPoint: "think",
    sourceType: "text",
    mode,
    modelName,
    promptVersion: PROMPT_VERSIONS.think,
    requestPayload: {
      questionPreview: question.slice(0, 200),
      contextPreview: context?.slice(0, 200) ?? null,
      hasEmbedding,
    },
    metadata: {
      mode,
    },
  });
  const encoder = new TextEncoder();
  const phases = PHASES[mode] || ["思考中..."];

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        let retrievedContext: Awaited<ReturnType<typeof searchKnowledge>> =
          [];
        let finalContextText = context?.trim() ?? "";
        let retrievalError: string | null = null;
        let contextPreviewItems: ReturnType<typeof buildContextPreviewItems> = [];

        try {
          sendEvent({ phase: "搜索记忆层..." });
          retrievedContext = await runEvalSpan({
            supabase,
            userId: user.id,
            traceId,
            spanName: "retrieve_knowledge_context",
            inputPayload: {
              questionPreview: question.slice(0, 200),
              limit: 4,
              threshold: 0.45,
              hasEmbedding,
            },
            fn: () =>
              searchKnowledge(question, {
                supabase,
                limit: 4,
                semanticThreshold: 0.45,
              }),
            outputMapper: (value) => ({
              matchIds: value.map((item) => item.id),
              matchCount: value.length,
              retrievalSources: summarizeRetrievalSources(value),
            }),
          });

          if (retrievedContext.length > 0) {
            contextPreviewItems = buildContextPreviewItems(retrievedContext);
            const retrievedText = buildKnowledgeContextText(retrievedContext);
            finalContextText = [finalContextText, retrievedText]
              .filter(Boolean)
              .join("\n\n");
          }
        } catch (error) {
          retrievalError =
            error instanceof Error ? error.message : String(error);
          console.warn("Think retrieval degraded:", error);
        }

        // 发送第一个阶段
        sendEvent({ phase: phases[0] });

        // 使用 heavy 模型进行深度思考
        const model = getModel("heavy");
        const systemPrompt = getSystemPrompt(mode, finalContextText);

        // 启动 AI 生成（与阶段动画并行）
        const aiPromise = runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "generate_think_response",
          inputPayload: {
            mode,
            questionPreview: question.slice(0, 200),
            contextLength: finalContextText.length,
          },
          fn: () =>
            generateText({
              model,
              system: systemPrompt,
              prompt: question,
              temperature: 0.8, // 稍高温度以获得更有创意的回答
            }),
          outputMapper: (value) => ({
            textPreview: value.text.slice(0, 300),
          }),
        });

        // 模拟进度阶段（给 AI 时间生成）
        for (let i = 1; i < phases.length; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          sendEvent({ phase: phases[i] });
        }

        // 等待 AI 结果
        const { text } = await aiPromise;

        const result = await parseThinkResult(mode, systemPrompt, text);

        const thinkSession = await runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "persist_think_session",
          inputPayload: {
            mode,
            retrievedCount: retrievedContext.length,
          },
          fn: async () => {
            const normalizedInsights = Array.isArray(result.insights)
              ? result.insights.filter(
                  (item: unknown): item is string => typeof item === "string"
                )
              : [];
            const insertPayload: Database["public"]["Tables"]["think_sessions"]["Insert"] =
              {
                user_id: user.id,
                mode,
                question,
                responses: [toJson(result)],
                insights: normalizedInsights,
                knowledge_context: toJson(retrievedContext) as Json[],
              };
            const { data, error } = await supabase
              .from("think_sessions")
              .insert(insertPayload)
              .select("id, mode, question, insights, knowledge_context, created_at")
              .single();

            if (error) throw error;
            return data;
          },
          outputMapper: (value) => ({
            sessionId: value.id,
          }),
        });

        const resultPayload = {
          traceId,
          sessionId: thinkSession.id,
          contextItems: retrievedContext.length,
          result,
        };

        await updateEvalTrace({
          supabase,
          traceId,
          status: "success",
          responsePayload: resultPayload,
          metadata: {
            mode,
            contextItems: retrievedContext.length,
            contextIds: retrievedContext.map((item) => item.id),
            contextPreview: finalContextText.slice(0, 2000),
            contextPreviewItems,
            retrievalSources: summarizeRetrievalSources(retrievedContext),
            retrievalError,
          },
          sessionId: thinkSession.id,
          startedAtMs: requestStartedAtMs,
        });

        await runCodeEvaluatorsForTrace({
          supabase,
          userId: user.id,
          traceId,
          entryPoint: "think",
          mode,
          requestPayload: {
            question,
            context: finalContextText,
          },
          responsePayload: resultPayload,
          metadata: {
            contextItems: retrievedContext.length,
            contextPreview: finalContextText.slice(0, 2000),
            contextPreviewItems,
            retrievalSources: summarizeRetrievalSources(retrievedContext),
          },
        });

        sendEvent({ phase: "done", ...resultPayload });
      } catch (err) {
        console.error("Think error:", err);
        await updateEvalTrace({
          supabase,
          traceId,
          status: "error",
          responsePayload: {},
          metadata: {
            mode,
          },
          errorMessage: err instanceof Error ? err.message : String(err),
          startedAtMs: requestStartedAtMs,
        });
        sendEvent({
          phase: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

import { generateText } from "ai";
import { getConfiguredModelName, getModel } from "@/lib/models";
import { cleanAIResponse } from "@/lib/utils";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Database, Json } from "@/lib/database.types";

export const maxDuration = 300;
import {
  buildKnowledgeContextText,
  createEvalTrace,
  PROMPT_VERSIONS,
  runEvalSpan,
  toJson,
  updateEvalTrace,
} from "@/lib/evals";
import { THINK_PHASES, getThinkSystemPrompt } from "@/lib/think-prompts";
import { runCodeEvaluatorsForTrace } from "@/lib/evaluators";
import {
  searchKnowledge,
  summarizeRetrievalSources,
  type RetrievedKnowledgeItem,
} from "@/lib/retrieval";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildMirrorWikiContext,
  overrideFigureUrls,
  type MirrorWikiContext,
} from "@/lib/think-mirror";
import {
  buildCoachWebContext,
  type CoachWebContext,
} from "@/lib/think-coach";
import {
  buildCrossdomainWebContext,
  type CrossdomainWebContext,
} from "@/lib/think-crossdomain";

// Rate limit: 每用户每分钟最多 6 次 think 请求（heavy 操作）
const THINK_RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };
// SSE 心跳
const HEARTBEAT_INTERVAL_MS = 15_000;
// Think 温度:per-mode 配置,来自 2026-04-13 Claude-judge temperature A/B eval
// (scripts/temp-eval-results/2026-04-13T07-37-42-404Z-rejudged-claude-judged)
// - coach: 0.8  两 judge 一致最优
// - crossdomain: 0.3  Claude judge 下 0.3/0.5 并列最高,0.8 最差
// - roundtable: 0.5  Claude judge 下最高,MiniMax judge 下第二;0.8 有 parse 失败 + latency outlier
// - mirror: 0.8  温度对 mirror 无有效信号(两 judge 推荐相反),保持默认;真正问题是 prompt 的可操作性短板
// 可通过 THINK_TEMPERATURE env 整体覆盖,便于实验时回退到单一值
const THINK_TEMPERATURE_BY_MODE: Record<ThinkRequest["mode"], number> = {
  roundtable: 0.5,
  coach: 0.8,
  crossdomain: 0.3,
  mirror: 0.8,
};
const THINK_TEMPERATURE_OVERRIDE = process.env.THINK_TEMPERATURE
  ? Number(process.env.THINK_TEMPERATURE)
  : null;

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

const PHASES = THINK_PHASES;
const getSystemPrompt = getThinkSystemPrompt;

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

  // 限流检查
  const rateLimit = await checkRateLimit(
    supabase,
    user.id,
    "think",
    THINK_RATE_LIMIT
  );
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: `思考请求过于频繁：每分钟最多 ${rateLimit.maxRequests} 次。请在 ${rateLimit.retryAfterSeconds}s 后重试。`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

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
    },
    metadata: {
      mode,
    },
  });
  const encoder = new TextEncoder();
  const phases = PHASES[mode] || ["思考中..."];

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function sendEvent(data: Record<string, unknown>) {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      }
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* controller may be closed */
        }
      }, HEARTBEAT_INTERVAL_MS);

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
            },
            fn: () =>
              searchKnowledge(question, {
                supabase,
                limit: 4,
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

        // 三个 grounded 模式的 pre-LLM pipeline (mirror=Wikipedia, coach/crossdomain=MiniMax web search)
        let mirrorWiki: MirrorWikiContext | null = null;
        let coachWeb: CoachWebContext | null = null;
        let crossdomainWeb: CrossdomainWebContext | null = null;

        if (mode === "mirror") {
          try {
            mirrorWiki = await runEvalSpan({
              supabase,
              userId: user.id,
              traceId,
              spanName: "mirror_wiki_pipeline",
              inputPayload: {
                questionPreview: question.slice(0, 200),
                knowledgeContextLength: finalContextText.length,
              },
              fn: () =>
                buildMirrorWikiContext(
                  question,
                  finalContextText,
                  (phase) => {
                    if (phase === "candidates")
                      sendEvent({ phase: phases[0] ?? "推荐历史先驱候选..." });
                    if (phase === "wikipedia")
                      sendEvent({
                        phase: phases[1] ?? "拉取 Wikipedia 事实锚点...",
                      });
                  }
                ),
              outputMapper: (v) => ({
                candidateCount: v.candidates.length,
                wikiHitCount: v.figures.length,
                unmatched: v.unmatched,
                wikiFetchOk: v.wikiFetchOk,
                candidateLLMCallOk: v.candidateLLMCallOk,
                errorMessage: v.errorMessage,
              }),
            });
          } catch (e) {
            console.warn("Mirror wiki pipeline failed, falling back:", e);
          }
          sendEvent({ phase: phases[2] ?? "基于事实讲述故事..." });
        } else if (mode === "coach") {
          try {
            coachWeb = await runEvalSpan({
              supabase,
              userId: user.id,
              traceId,
              spanName: "coach_web_pipeline",
              inputPayload: {
                questionPreview: question.slice(0, 200),
                knowledgeContextLength: finalContextText.length,
              },
              fn: () =>
                buildCoachWebContext(
                  question,
                  finalContextText,
                  (phase) => {
                    if (phase === "topics")
                      sendEvent({ phase: "抽取学习主题..." });
                    if (phase === "search")
                      sendEvent({ phase: "验证真实学习资源..." });
                  }
                ),
              outputMapper: (v) => ({
                topicCount: v.topics.length,
                resourceCount: v.resources.length,
                searchOk: v.searchOk,
                candidateLLMCallOk: v.candidateLLMCallOk,
                errorMessage: v.errorMessage,
              }),
            });
          } catch (e) {
            console.warn("Coach web pipeline failed, falling back:", e);
          }
          sendEvent({ phase: phases[2] ?? "生成诊断报告..." });
        } else if (mode === "crossdomain") {
          try {
            crossdomainWeb = await runEvalSpan({
              supabase,
              userId: user.id,
              traceId,
              spanName: "crossdomain_web_pipeline",
              inputPayload: {
                questionPreview: question.slice(0, 200),
                knowledgeContextLength: finalContextText.length,
              },
              fn: () =>
                buildCrossdomainWebContext(
                  question,
                  finalContextText,
                  (phase) => {
                    if (phase === "candidates")
                      sendEvent({ phase: "选择跨域领域..." });
                    if (phase === "search")
                      sendEvent({ phase: "拉取跨域素材..." });
                  }
                ),
              outputMapper: (v) => ({
                domainCount: v.candidates.length,
                itemCount: v.items.length,
                searchOk: v.searchOk,
                candidateLLMCallOk: v.candidateLLMCallOk,
                errorMessage: v.errorMessage,
              }),
            });
          } catch (e) {
            console.warn("Crossdomain web pipeline failed, falling back:", e);
          }
          sendEvent({ phase: phases[2] ?? "建立跨域关联..." });
        } else {
          // 其他模式 (roundtable): 原有首阶段提示
          sendEvent({ phase: phases[0] });
        }

        // 使用 heavy 模型进行深度思考
        const model = getModel("heavy");
        const systemPrompt = getSystemPrompt(mode, {
          context: finalContextText,
          wikiContext: mirrorWiki?.promptText,
          webContext: coachWeb?.promptText || crossdomainWeb?.promptText,
        });

        const modeTemperature =
          THINK_TEMPERATURE_OVERRIDE ?? THINK_TEMPERATURE_BY_MODE[mode];

        const { text } = await runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "generate_think_response",
          inputPayload: {
            mode,
            questionPreview: question.slice(0, 200),
            contextLength: finalContextText.length,
            wikiContextLength: mirrorWiki?.promptText.length ?? 0,
            coachWebContextLength: coachWeb?.promptText.length ?? 0,
            crossdomainWebContextLength: crossdomainWeb?.promptText.length ?? 0,
            temperature: modeTemperature,
          },
          fn: () =>
            generateText({
              model,
              system: systemPrompt,
              prompt: question,
              temperature: modeTemperature,
            }),
          outputMapper: (value) => ({
            textPreview: value.text.slice(0, 300),
          }),
        });

        sendEvent({ phase: phases[phases.length - 1] ?? "整理回答..." });

        let result = await parseThinkResult(mode, systemPrompt, text);
        // mirror 模式: 用 Wikipedia canonical URL 覆盖 LLM 输出里的 wikipedia_url
        if (mode === "mirror" && mirrorWiki && mirrorWiki.figures.length > 0) {
          result = overrideFigureUrls(result, mirrorWiki.figures);
        }

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

        const groundingSources = mirrorWiki?.figures.length
          ? mirrorWiki.figures.map((f) => ({
              title: f.title,
              url: f.url,
              kind: "wikipedia" as const,
            }))
          : coachWeb?.resources.length
            ? coachWeb.resources.map((r) => ({
                index: r.index,
                title: r.title,
                url: r.link,
                snippet: r.snippet.slice(0, 200),
                topic: r.topicName,
                kind: "web" as const,
              }))
            : crossdomainWeb?.items.length
              ? crossdomainWeb.items.map((i) => ({
                  index: i.index,
                  title: i.title,
                  url: i.link,
                  snippet: i.snippet.slice(0, 200),
                  domain: i.domain,
                  kind: "web" as const,
                }))
              : [];

        const resultPayload = {
          traceId,
          sessionId: thinkSession.id,
          contextItems: retrievedContext.length,
          result,
          groundingSources,
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
            mirrorWiki: mirrorWiki
              ? {
                  candidateCount: mirrorWiki.candidates.length,
                  wikiHitCount: mirrorWiki.figures.length,
                  unmatched: mirrorWiki.unmatched,
                  wikiFetchOk: mirrorWiki.wikiFetchOk,
                  candidateLLMCallOk: mirrorWiki.candidateLLMCallOk,
                  sources: mirrorWiki.figures.map((f) => ({
                    title: f.title,
                    url: f.url,
                    lang: f.lang,
                  })),
                  errorMessage: mirrorWiki.errorMessage,
                }
              : null,
            coachWeb: coachWeb
              ? {
                  topicCount: coachWeb.topics.length,
                  resourceCount: coachWeb.resources.length,
                  searchOk: coachWeb.searchOk,
                  candidateLLMCallOk: coachWeb.candidateLLMCallOk,
                  topics: coachWeb.topics.map((t) => ({
                    name: t.name,
                    query: t.query,
                  })),
                  sources: coachWeb.resources.map((r) => ({
                    index: r.index,
                    title: r.title,
                    url: r.link,
                    topic: r.topicName,
                  })),
                  errorMessage: coachWeb.errorMessage,
                }
              : null,
            crossdomainWeb: crossdomainWeb
              ? {
                  domainCount: crossdomainWeb.candidates.length,
                  itemCount: crossdomainWeb.items.length,
                  searchOk: crossdomainWeb.searchOk,
                  candidateLLMCallOk: crossdomainWeb.candidateLLMCallOk,
                  candidates: crossdomainWeb.candidates.map((c) => ({
                    domain: c.domain,
                    queries: c.queries,
                  })),
                  sources: crossdomainWeb.items.map((i) => ({
                    index: i.index,
                    title: i.title,
                    url: i.link,
                    domain: i.domain,
                  })),
                  errorMessage: crossdomainWeb.errorMessage,
                }
              : null,
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
        clearInterval(heartbeat);
        closed = true;
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

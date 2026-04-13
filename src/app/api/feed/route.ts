import { generateText } from "ai";
import { after } from "next/server";
import { getConfiguredModelName, getModel } from "@/lib/models";
import { cleanAIResponse } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  extractFromUrl as extractUrl,
  extractFromPdf,
  extractFromDocx,
  ExtractionError,
} from "@/lib/extract";
import {
  buildKnowledgeSearchText,
  searchKnowledge,
  summarizeRetrievalSources,
} from "@/lib/retrieval";
import {
  PROMPT_VERSIONS,
  createEvalTrace,
  runEvalSpan,
  updateEvalTrace,
} from "@/lib/evals";
import { runCodeEvaluatorsForTrace } from "@/lib/evaluators";
import {
  classifyRelationships,
  generateConnectionSpark,
  checkCompileTrigger,
} from "@/lib/knowledge";
import type { RelationshipResult, SparkResult } from "@/lib/knowledge";
import { runCompileWithEval } from "@/lib/eval-pipelines";
import { checkRateLimit } from "@/lib/rate-limit";

// Vercel Serverless 超时配置：feed 管道涉及多步 AI 调用，需要充足时间
export const maxDuration = 300;

// Rate limit: 每用户每分钟最多 10 次 feed 请求
const FEED_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

// SSE heartbeat: 每 15s 发一个注释行防止代理断连
const HEARTBEAT_INTERVAL_MS = 15_000;

// ============================================================
// POST /api/feed — 认知飞轮 Feed 消化管道
// 支持：文本 / URL / 文件上传（PDF/DOCX/图片）
// 支持：链接 + 用户想法一起提交
// ============================================================

interface AnalysisResult {
  type: "article" | "thought" | "insight";
  title: string;
  summary: string;
  keyPoints: string[];
  userOpinions?: string[];
  tags: string[];
  domain: string;
}

function formatRetrievalReason(item: {
  retrieval_source: "lexical" | "llm" | "hybrid";
  llm_relevance?: number | null;
  lexical_score?: number | null;
}) {
  if (item.retrieval_source === "hybrid") {
    return "关键词 + LLM 相关";
  }

  if (item.retrieval_source === "llm" && item.llm_relevance != null) {
    return `LLM 相关度 ${(item.llm_relevance * 100).toFixed(0)}%`;
  }

  return "关键词/全文命中";
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  const requestStartedAtMs = Date.now();

  let input = "";
  let type: "url" | "text" | "file" = "text";
  let userNote = "";
  let fileName = "";
  let sourceUrl: string | null = null;

  // 解析请求：支持 JSON 和 FormData（文件上传）
  if (contentType.includes("multipart/form-data")) {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    userNote = (formData.get("note") as string) || "";
    const url = (formData.get("url") as string) || "";

    if (file) {
      type = "file";
      fileName = file.name;
      const buffer = await file.arrayBuffer();
      const ext = fileName.split(".").pop()?.toLowerCase();

      if (ext === "pdf") {
        input = await extractFromPdf(buffer);
      } else if (ext === "docx" || ext === "doc") {
        input = await extractFromDocx(buffer);
      } else if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext || "")) {
        // 图片：尚未支持 Vision API，仅当用户同时附带想法时接受
        if (userNote) {
          input = userNote;
          type = "text";
        } else {
          return Response.json(
            {
              error:
                "图片内容识别暂未接入。请在「想法」里描述图片要点，或改为粘贴文本/URL。",
            },
            { status: 400 }
          );
        }
      } else {
        // 尝试作为文本文件读取
        input = new TextDecoder().decode(buffer).slice(0, 50000);
      }
    } else if (url) {
      type = "url";
      input = url;
      sourceUrl = url;
    }
  } else {
    const json = await req.json();
    input = json.input || "";
    type = json.type || "text";
    userNote = json.note || "";
    if (type === "url") sourceUrl = input;
  }

  // 检查是否有 AI 模型可用
  const hasAI =
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.MINIMAX_API_KEY;

  if (!isSupabaseConfigured() || !hasAI) {
    return Response.json({
      mode: "demo",
      result: getDemoResult(input, type),
    });
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
    "feed",
    FEED_RATE_LIMIT
  );
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: `请求过于频繁：每分钟最多 ${rateLimit.maxRequests} 次。请在 ${rateLimit.retryAfterSeconds}s 后重试。`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const modelName = getConfiguredModelName("light");
  const requestPayload = {
    type,
    sourceUrl,
    fileName: fileName || null,
    inputPreview: input.slice(0, 200),
    userNotePreview: userNote.slice(0, 200),
  };
  const traceId = await createEvalTrace({
    supabase,
    userId: user.id,
    entryPoint: "feed",
    sourceType: type,
    modelName,
    promptVersion: PROMPT_VERSIONS.feed,
    requestPayload,
    metadata: {
      contentType,
      fileProvided: Boolean(fileName),
      sourceUrl,
    },
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function sendEvent(data: Record<string, unknown>) {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      }
      // 心跳：SSE 注释行，不触发前端 onmessage，只保活连接
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* controller may be closed */
        }
      }, HEARTBEAT_INTERVAL_MS);

      try {
        // Phase 1: 提取内容
        let content = input;
        let detectedPlatform =
          type === "url" ? "web" : type === "file" ? "file" : "text";
        if (type === "url") {
          sendEvent({ phase: "正在读取内容..." });
          const extracted = await runEvalSpan({
            supabase,
            userId: user.id,
            traceId,
            spanName: "extract_content",
            inputPayload: {
              type,
              sourceUrl: input,
            },
            fn: () => extractUrl(input),
            outputMapper: (value) => ({
              title: value.title,
              platform: value.platform,
              contentLength: value.content.length,
            }),
          });
          content = extracted.content;
          detectedPlatform = extracted.platform;
          sendEvent({
            phase: `已识别: ${extracted.platform === "twitter" ? "X/Twitter" : extracted.platform === "youtube" ? "YouTube" : extracted.platform === "wechat" ? "微信公众号" : "网页"}`,
          });
        } else if (type === "file") {
          await runEvalSpan({
            supabase,
            userId: user.id,
            traceId,
            spanName: "parse_upload",
            inputPayload: {
              fileName,
            },
            fn: async () => ({
              fileName,
              contentLength: content.length,
            }),
            outputMapper: (value) => value,
          });
          sendEvent({ phase: `正在解析 ${fileName}...` });
        }

        // 如果有用户想法，拼接到内容中
        if (userNote) {
          content = `${content}\n\n---\n用户的想法和批注：\n${userNote}`;
        }

        // Phase 2: AI 分析
        sendEvent({ phase: "外脑正在理解..." });
        const analysis = await runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "analyze_content",
          inputPayload: {
            contentPreview: content.slice(0, 500),
            contentLength: content.length,
            hasUserNote: Boolean(userNote),
          },
          fn: () => analyzeContent(content, Boolean(userNote)),
          outputMapper: (value) => ({
            type: value.type,
            title: value.title,
            domain: value.domain,
            tags: value.tags,
            keyPointsCount: value.keyPoints.length,
          }),
        });

        // Phase 3: 检索历史关联（全文搜索 + LLM Index 精排）
        let similar: Awaited<ReturnType<typeof searchKnowledge>> = [];
        const retrievalText = buildKnowledgeSearchText({
          title: analysis.title,
          summary: analysis.summary,
          tags: analysis.tags,
          rawContent: content,
        });

        sendEvent({ phase: "搜索历史关联..." });
        similar = await runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "retrieve_similar_knowledge",
          inputPayload: {
            limit: 3,
          },
          fn: () =>
            searchKnowledge(retrievalText, {
              supabase,
              limit: 3,
            }),
          outputMapper: (value) => ({
            similarCount: value.length,
            matchIds: value.map((item) => item.id),
            retrievalSources: summarizeRetrievalSources(value),
          }),
        });

        // Phase 4: 存入数据库
        sendEvent({ phase: "存入记忆层..." });
        const inserted = await runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "persist_knowledge",
          inputPayload: {
            type: userNote ? "thought" : analysis.type,
            title: analysis.title,
            domain: analysis.domain,
            sourceType: type === "file" ? "text" : type,
          },
          fn: async () => {
            const { data, error } = await supabase
              .from("knowledge_items")
              .insert({
                user_id: user.id,
                type: userNote ? "thought" : analysis.type,
                title: analysis.title,
                summary: analysis.summary,
                tags: analysis.tags,
                domain: analysis.domain,
                source_url: sourceUrl,
                source_type: type === "file" ? "text" : type,
                raw_content: content.slice(0, 50000),
                key_points: analysis.keyPoints,
                ...(userNote ? { user_note: userNote } : {}),
              })
              .select()
              .single();

            if (error) throw error;
            return data;
          },
          outputMapper: (value) => ({
            knowledgeItemId: value.id,
          }),
        });

        // Phase 5: 创建关联
        if (similar.length > 0) {
          await runEvalSpan({
            supabase,
            userId: user.id,
            traceId,
            spanName: "create_connections",
            inputPayload: {
              similarCount: similar.length,
            },
            fn: async () => {
              const connections = similar.map((s) => ({
                user_id: user.id,
                from_id: inserted.id,
                to_id: s.id,
                connection_type: "similarity" as const,
                similarity_score: s.llm_relevance ?? s.lexical_score ?? null,
                reason: formatRetrievalReason(s),
              }));
              const { error } = await supabase
                .from("knowledge_connections")
                .insert(connections);

              if (error) throw error;
              return connections;
            },
            outputMapper: (value) => ({
              connectionCount: value.length,
            }),
          });
        }

        // Phase 5+ & 6: 关系分类 + 跨域闪念（并行执行）
        let relationships: RelationshipResult[] = [];
        let spark: SparkResult | null = null;

        const [classifyResult, sparkResult] = await Promise.all([
          // Phase 5+: 关系分类
          (async () => {
            if (similar.length === 0) return [] as RelationshipResult[];
            try {
              sendEvent({ phase: "分析知识关系..." });
              return await runEvalSpan({
                supabase,
                userId: user.id,
                traceId,
                spanName: "classify_relationships",
                inputPayload: {
                  newItemTitle: analysis.title,
                  similarCount: similar.length,
                },
                fn: async () => {
                  const results = await classifyRelationships(analysis, similar);
                  // Upsert classified connections
                  for (const rel of results) {
                    await supabase
                      .from("knowledge_connections")
                      .upsert(
                        {
                          user_id: user.id,
                          from_id: inserted.id,
                          to_id: rel.targetId,
                          connection_type: rel.type,
                          reason: rel.reason,
                        },
                        { onConflict: "from_id,to_id" }
                      );
                  }
                  return results;
                },
                outputMapper: (value) => ({
                  classifiedCount: value.length,
                  types: value.map((r) => r.type),
                }),
              });
            } catch (err) {
              console.warn("Classify relationships failed, falling back to similarity connections:", err);
              return [] as RelationshipResult[];
            }
          })(),
          // Phase 6: 跨域闪念
          (async () => {
            try {
              sendEvent({ phase: "寻找跨域灵感..." });
              return await runEvalSpan({
                supabase,
                userId: user.id,
                traceId,
                spanName: "generate_spark",
                inputPayload: {
                  domain: analysis.domain,
                  title: analysis.title,
                },
                fn: async () => {
                  const { data: crossDomainItems } = await supabase
                    .from("knowledge_items")
                    .select("title, summary, domain")
                    .eq("user_id", user.id)
                    .neq("domain", analysis.domain)
                    .limit(10);
                  return generateConnectionSpark(analysis, crossDomainItems ?? []);
                },
                outputMapper: (value) => ({
                  hasSpark: value !== null,
                  sourceDomain: value?.sourceDomain ?? null,
                  isGeneral: value?.isGeneral ?? null,
                }),
              });
            } catch (err) {
              console.warn("Generate spark failed, skipping:", err);
              return null;
            }
          })(),
        ]);

        relationships = classifyResult;
        spark = sparkResult;

        // Phase 7: 编译触发检查
        let compileTrigger: { shouldCompile: boolean; isUpdate: boolean; itemCount: number } = {
          shouldCompile: false,
          isUpdate: false,
          itemCount: 0,
        };
        try {
          sendEvent({ phase: "检查知识编译..." });
          compileTrigger = await runEvalSpan({
            supabase,
            userId: user.id,
            traceId,
            spanName: "check_compile_trigger",
            inputPayload: {
              domain: analysis.domain,
            },
            fn: () => checkCompileTrigger(supabase, user.id, analysis.domain),
            outputMapper: (value) => value,
          });

          if (compileTrigger.shouldCompile) {
            after(async () => {
              try {
                await runCompileWithEval({
                  supabase,
                  userId: user.id,
                  domain: analysis.domain,
                  modelName,
                  triggerSource: "feed_auto",
                  sourceTraceId: traceId,
                });
              } catch (err) {
                console.error("Background domain compilation failed:", err);
              }
            });
          }
        } catch (err) {
          console.warn("Compile trigger check failed, skipping:", err);
        }

        const resultPayload = {
          id: inserted.id,
          traceId,
          input: sourceUrl || input.slice(0, 100),
          type,
          title: analysis.title,
          summary: analysis.summary,
          keyPoints: analysis.keyPoints,
          userOpinions: analysis.userOpinions,
          tags: analysis.tags,
          domain: analysis.domain,
          connections: similar.map(
            (s) => `「${s.title}」— ${formatRetrievalReason(s)}`
          ),
          spark,
          relationships,
          compileTrigger,
          timestamp: new Date().toLocaleTimeString("zh-CN"),
        };

        await updateEvalTrace({
          supabase,
          traceId,
          status: "success",
          responsePayload: { result: resultPayload },
          metadata: {
            platform: detectedPlatform,
            contentLength: content.length,
            contentPreview: content.slice(0, 1200),
            similarCount: similar.length,
            retrievalSources: summarizeRetrievalSources(similar),
            sourceUrl,
            fileName: fileName || null,
          },
          knowledgeItemId: inserted.id,
          startedAtMs: requestStartedAtMs,
        });

        await runCodeEvaluatorsForTrace({
          supabase,
          userId: user.id,
          traceId,
          entryPoint: "feed",
          requestPayload,
          responsePayload: { result: resultPayload },
          metadata: {
            contentLength: content.length,
            platform: detectedPlatform,
          },
        });

        sendEvent({
          phase: "done",
          result: resultPayload,
        });
      } catch (err) {
        console.error("Feed pipeline error:", err);
        await updateEvalTrace({
          supabase,
          traceId,
          status: "error",
          responsePayload: {},
          metadata: {
            sourceUrl,
            fileName: fileName || null,
          },
          errorMessage: err instanceof Error ? err.message : String(err),
          startedAtMs: requestStartedAtMs,
        });
        // ExtractionError 附带用户友好提示
        if (err instanceof ExtractionError) {
          sendEvent({
            phase: "extraction_failed",
            error: err.userHint,
            detail: err.message,
          });
        } else {
          sendEvent({
            phase: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
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

// ============================================================
// 辅助函数
// ============================================================

/** AI 内容分析 */
async function analyzeContent(content: string, hasUserNote: boolean): Promise<AnalysisResult> {
  const model = getModel("light");

  const userNoteInstruction = hasUserNote
    ? `
## 用户观点分离（重要）
内容中"---"分隔线之后的"用户的想法和批注"部分是用户自己的评论。你必须：
- keyPoints 只包含原文/文章本身的核心观点，不受用户批注影响
- summary 只总结原文内容
- 用户的想法、评价、质疑、感受放到单独的 userOpinions 数组中
- 如果用户的批注中包含有价值的判断或质疑，提炼为简洁的观点放入 userOpinions`
    : "";

  const outputFormat = hasUserNote
    ? `{"type":"article","title":"具体中文标题（包含核心论点或关键对象）","summary":"3-5句话的原文摘要（不包含用户观点）","keyPoints":["原文要点1","原文要点2","原文要点3"],"userOpinions":["用户观点1","用户观点2"],"tags":["标签1","标签2","标签3"],"domain":"领域名"}`
    : `{"type":"article","title":"具体中文标题（包含核心论点或关键对象）","summary":"3-5句话的摘要","keyPoints":["要点1","要点2","要点3"],"tags":["标签1","标签2","标签3"],"domain":"领域名"}`;

  const systemPrompt = `你是认知飞轮的内容分析引擎。分析用户输入的内容，返回 JSON 格式结果。

## 领域判断
从内容主题归纳一个简洁的中文领域名（2-6 字），例如：投资、Agent Building、健康、一人公司、创业、产品设计、技术、科学、历史、哲学、心理学 等。
- 优先使用用户已有的领域（若有提示）
- 跨多个领域或无明确主题时用"跨领域"
- 不要编造过于细分的领域名

## 类型判断
- article: 阅读摘要、文章内容
- thought: 用户自己的想法、反思
- insight: 从思考中提炼的洞察

## 标题要求
- 标题必须包含核心论点、关键数据或特定对象，能与其他同话题内容区分
- 禁止使用"关于XX的思考""某某的观点总结"这类套话模板
- 好的标题示例："巴菲特2024股东信：集中投资优于分散，自由现金流是核心指标"
- 差的标题示例："巴菲特关于投资的最新讨论"

## 标签要求
- 每个标签必须有检索区分度，不要使用过于宽泛的词（如"AI""技术"）
- 不得用中英文重复表达同一概念（如同时出现"LLM"和"大语言模型"）
- 不要使用平台名（如"YouTube""微信"）作为标签
- 优先使用具体人名、方法论、核心概念作标签
${userNoteInstruction}
只返回合法 JSON，不要包含 markdown 代码块或其他文字。`;

  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt: `分析以下内容：

${content.slice(0, 30000)}

返回格式：
${outputFormat}`,
  });

  const parsed = await parseJsonWithRepair(text, systemPrompt, hasUserNote);
  return validateAnalysisResult(parsed, content);
}

/** 尝试解析 JSON，失败时用 LLM 修复，仍失败时抛错 */
async function parseJsonWithRepair(
  rawText: string,
  originalSystemPrompt: string,
  hasUserNote: boolean
): Promise<Record<string, unknown>> {
  const cleaned = cleanAIResponse(rawText);

  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    /* fall through */
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }

  // LLM 修复兜底
  try {
    const repairModel = getModel("light");
    const repairResult = await generateText({
      model: repairModel,
      system: `${originalSystemPrompt}\n\n你现在是 JSON 修复器。你的唯一任务是把已有内容修复成严格合法的 JSON。不要补充解释，不要输出 markdown 代码块。`,
      prompt: `请把下面这段输出修复成合法 JSON，保持原意。必须包含字段：type, title, summary, keyPoints (array), tags (array), domain${hasUserNote ? ", userOpinions (array)" : ""}。

${cleaned}`,
      temperature: 0,
    });
    const repaired = cleanAIResponse(repairResult.text);
    try {
      return JSON.parse(repaired) as Record<string, unknown>;
    } catch {
      const repairedMatch = repaired.match(/\{[\s\S]*\}/);
      if (repairedMatch) {
        return JSON.parse(repairedMatch[0]) as Record<string, unknown>;
      }
    }
  } catch (err) {
    console.warn("JSON repair failed:", err);
  }

  throw new Error("AI 返回格式错误，无法解析为 JSON");
}

/** 校验并规范化 AI 分析结果 */
function validateAnalysisResult(
  parsed: Record<string, unknown>,
  sourceContent: string
): AnalysisResult {
  const type =
    parsed.type === "thought" || parsed.type === "insight"
      ? (parsed.type as "thought" | "insight")
      : "article";

  const asString = (v: unknown, fallback = ""): string =>
    typeof v === "string" && v.trim() ? v.trim() : fallback;

  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];

  const result: AnalysisResult = {
    type,
    title: asString(parsed.title, sourceContent.slice(0, 30) + "..."),
    summary: asString(parsed.summary, sourceContent.slice(0, 200)),
    keyPoints: asStringArray(parsed.keyPoints),
    tags: asStringArray(parsed.tags),
    domain: asString(parsed.domain, "跨领域"),
  };

  if (Array.isArray(parsed.userOpinions)) {
    result.userOpinions = asStringArray(parsed.userOpinions);
  }

  if (result.keyPoints.length === 0) {
    result.keyPoints = [sourceContent.slice(0, 100)];
  }
  if (result.tags.length === 0) {
    result.tags = ["未分类"];
  }

  return result;
}

/** Demo 模式降级响应 */
function getDemoResult(input: string, type: string) {
  return {
    id: `demo-${Date.now()}`,
    input,
    type,
    title:
      type === "url"
        ? "Demo Mode"
        : (input.slice(0, 30) || "未命名") + "...",
    keyPoints: [
      "Demo 模式：未配置后端服务",
      "请设置环境变量",
    ],
    tags: ["demo"],
    domain: "跨领域",
    connections: [],
    timestamp: new Date().toLocaleTimeString("zh-CN"),
  };
}

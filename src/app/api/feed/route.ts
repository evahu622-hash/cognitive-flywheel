import { generateText } from "ai";
import { after } from "next/server";
import { getConfiguredModelName, getModel } from "@/lib/models";
import { cleanAIResponse } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase";
import { createServerSupabase } from "@/lib/supabase-server";
import { generateEmbedding, isEmbeddingConfigured } from "@/lib/embeddings";
import {
  extractFromUrl as extractUrl,
  extractFromPdf,
  extractFromDocx,
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
  compileDomainSummary,
} from "@/lib/knowledge";
import type { RelationshipResult, SparkResult } from "@/lib/knowledge";

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
  tags: string[];
  domain: string;
}

function formatRetrievalReason(item: {
  retrieval_source: "lexical" | "semantic" | "hybrid";
  similarity?: number | null;
}) {
  if (item.retrieval_source === "hybrid") {
    return "关键词 + 语义关联";
  }

  if (item.retrieval_source === "semantic" && item.similarity != null) {
    return `语义相似度 ${(item.similarity * 100).toFixed(0)}%`;
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
        // 图片：暂存内容描述，后续接入 vision API
        input = `[用户上传了图片: ${fileName}]`;
        if (userNote) {
          input = userNote;
          type = "text";
        }
      } else {
        // 尝试作为文本文件读取
        input = new TextDecoder().decode(buffer).slice(0, 10000);
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

  const hasEmbedding = isEmbeddingConfigured();
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const modelName = getConfiguredModelName("light");
  const requestPayload = {
    type,
    sourceUrl,
    fileName: fileName || null,
    inputPreview: input.slice(0, 200),
    userNotePreview: userNote.slice(0, 200),
    hasEmbedding,
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
      function sendEvent(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      }

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
          fn: () => analyzeContent(content),
          outputMapper: (value) => ({
            type: value.type,
            title: value.title,
            domain: value.domain,
            tags: value.tags,
            keyPointsCount: value.keyPoints.length,
          }),
        });

        // Phase 3: 构建检索线索
        let embedding: number[] | null = null;
        let similar: Awaited<ReturnType<typeof searchKnowledge>> = [];
        let embeddingError: string | null = null;
        const retrievalText = buildKnowledgeSearchText({
          title: analysis.title,
          summary: analysis.summary,
          tags: analysis.tags,
          rawContent: content,
        });

        if (hasEmbedding) {
          try {
            sendEvent({ phase: "生成知识向量..." });
            embedding = await runEvalSpan({
              supabase,
              userId: user.id,
              traceId,
              spanName: "generate_embedding",
              inputPayload: {
                retrievalTextPreview: retrievalText.slice(0, 300),
              },
              fn: () => generateEmbedding(retrievalText),
              outputMapper: (value) => ({
                dimensions: value.length,
              }),
            });
          } catch (error) {
            embeddingError =
              error instanceof Error ? error.message : String(error);
            console.warn("Embedding pipeline degraded:", error);
            sendEvent({ phase: "语义检索不可用，改用关键词关联..." });
          }
        }

        sendEvent({ phase: "搜索历史关联..." });
        similar = await runEvalSpan({
          supabase,
          userId: user.id,
          traceId,
          spanName: "retrieve_similar_knowledge",
          inputPayload: {
            threshold: 0.5,
            limit: 3,
            hasEmbedding: Boolean(embedding),
          },
          fn: () =>
            searchKnowledge(retrievalText, {
              supabase,
              limit: 3,
              semanticThreshold: 0.5,
              includeSemantic: Boolean(embedding),
              queryEmbedding: embedding,
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
                raw_content: content.slice(0, 10000),
                ...(embedding ? { embedding: JSON.stringify(embedding) } : {}),
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
                similarity_score: s.similarity,
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
                        { onConflict: "user_id,from_id,to_id" }
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
                await compileDomainSummary(supabase, user.id, analysis.domain);
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
            hasEmbedding,
            embeddingError,
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

// ============================================================
// 辅助函数
// ============================================================

/** AI 内容分析 */
async function analyzeContent(content: string): Promise<AnalysisResult> {
  const model = getModel("light");

  const { text } = await generateText({
    model,
    system: `你是认知飞轮的内容分析引擎。分析用户输入的内容，返回 JSON 格式结果。

领域必须是以下之一：投资、Agent Building、健康、一人公司、跨领域
类型判断规则：
- article: 阅读摘要、文章内容
- thought: 用户自己的想法、反思
- insight: 从思考中提炼的洞察

如果内容包含"用户的想法和批注"部分，请同时考虑原文和用户批注来生成摘要。

只返回合法 JSON，不要包含 markdown 代码块或其他文字。`,
    prompt: `分析以下内容：

${content.slice(0, 4000)}

返回格式：
{"type":"article","title":"简洁中文标题","summary":"3-5句话的摘要","keyPoints":["要点1","要点2","要点3"],"tags":["标签1","标签2","标签3"],"domain":"领域名"}`,
  });

  const cleaned = cleanAIResponse(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fall through
      }
    }
    return {
      type: "article",
      title: content.slice(0, 30) + "...",
      summary: content.slice(0, 200),
      keyPoints: [content.slice(0, 100)],
      tags: ["未分类"],
      domain: "跨领域",
    };
  }
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

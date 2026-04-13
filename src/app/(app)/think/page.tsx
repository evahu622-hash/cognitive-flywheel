"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  GraduationCap,
  Shuffle,
  History,
  ArrowLeft,
  BookmarkPlus,
  RotateCcw,
} from "lucide-react";

type ThinkMode = "roundtable" | "coach" | "crossdomain" | "mirror" | null;

interface GroundingSource {
  index?: number;
  title: string;
  url: string;
  snippet?: string;
  topic?: string;
  domain?: string;
  kind: "wikipedia" | "web";
}

interface ThinkResultEnvelope {
  traceId: string | null;
  sessionId: string | null;
  contextItems: number;
  data: Record<string, unknown>;
  groundingSources: GroundingSource[];
}

interface ModeConfig {
  id: ThinkMode;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  placeholder: string;
}

const modes: ModeConfig[] = [
  {
    id: "roundtable",
    title: "圆桌会议",
    subtitle: "Roundtable",
    description: "召集多位专家从不同视角挑战和完善你的想法",
    icon: Users,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    placeholder: "输入你想讨论的问题或想法，专家团会从不同角度分析...",
  },
  {
    id: "coach",
    title: "认知教练",
    subtitle: "Cognitive Coach",
    description: "发现你的知识盲区，生成个性化学习路径",
    icon: GraduationCap,
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/30",
    placeholder: "描述你想深入了解的领域或最近的困惑...",
  },
  {
    id: "crossdomain",
    title: "跨域连接",
    subtitle: "Cross-Domain",
    description: "从其他领域借鉴灵感，发现意想不到的类比",
    icon: Shuffle,
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/30",
    placeholder: "输入一个概念或问题，看看其他领域怎么看...",
  },
  {
    id: "mirror",
    title: "历史镜鉴",
    subtitle: "History Mirror",
    description: "先驱们遇到过同样的问题，看看他们怎么做的",
    icon: History,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    placeholder: "描述你当前面临的困境或决策...",
  },
];

// ============================================================
// 各模式的结果渲染组件
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */

function SourcesList({
  sources,
  label = "引用来源",
}: {
  sources: GroundingSource[];
  label?: string;
}) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-2 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        🔗 {label} ({sources.length})
      </div>
      <ol className="space-y-1.5">
        {sources.map((src, i) => (
          <li key={i} className="text-[11px] text-muted-foreground leading-relaxed">
            <span className="font-mono text-[10px] mr-1">[{src.index ?? i + 1}]</span>
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground underline-offset-2 hover:underline"
            >
              {src.title}
            </a>
            {(src.topic || src.domain) && (
              <span className="ml-1 text-[10px] opacity-60">
                · {src.topic ?? src.domain}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RoundtableResult({
  data,
  traceId,
  sessionId,
}: {
  data: any;
  traceId: string | null;
  sessionId: string | null;
  groundingSources: GroundingSource[];
}) {
  return (
    <div className="space-y-4">
      {(data.experts ?? []).map((expert: any, i: number) => (
        <Card key={i} className="">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{expert.avatar}</span>
              <div>
                <div className="font-semibold">{expert.name}</div>
                <div className="text-xs text-muted-foreground">{expert.tag}</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed">{expert.content}</p>
          </CardContent>
        </Card>
      ))}
      <InsightBox insights={data.insights ?? []} traceId={traceId} sessionId={sessionId} />
    </div>
  );
}

function CoachResult({
  data,
  traceId,
  sessionId,
  groundingSources,
}: {
  data: any;
  traceId: string | null;
  sessionId: string | null;
  groundingSources: GroundingSource[];
}) {
  return (
    <div className="space-y-4">
      <Card className="">
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-green-500" />
            <span className="font-semibold">认知诊断报告</span>
          </div>

          {data.strengths?.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">✅ 你的认知优势</div>
              <ul className="text-sm space-y-1 text-muted-foreground">
                {data.strengths.map((s: string, i: number) => (
                  <li key={i}>• {s}</li>
                ))}
              </ul>
            </div>
          )}

          {data.blindSpots?.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">⚠️ 发现的盲区</div>
              <ul className="text-sm space-y-1">
                {data.blindSpots.map((spot: any, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={spot.severity === "high" ? "text-red-500" : "text-blue-500"}>
                      {spot.severity === "high" ? "🔸" : "🔹"}
                    </span>
                    <span>
                      <strong>{spot.area}</strong>：{spot.detail}
                      {spot.suggestion && (
                        <span className="text-muted-foreground"> → {spot.suggestion}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.learningPath?.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">📚 个性化学习路径</div>
              <div className="space-y-2">
                {data.learningPath.map((item: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 text-sm bg-muted/50 rounded-lg p-2">
                    <Badge variant={item.priority === "高" ? "default" : "secondary"} className="text-xs shrink-0">
                      {item.week}
                    </Badge>
                    <span>{item.task}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <SourcesList sources={groundingSources} label="已验证的学习资源" />
        </CardContent>
      </Card>
      <InsightBox insights={data.insights ?? []} traceId={traceId} sessionId={sessionId} />
    </div>
  );
}

function CrossDomainResult({
  data,
  traceId,
  sessionId,
  groundingSources,
}: {
  data: any;
  traceId: string | null;
  sessionId: string | null;
  groundingSources: GroundingSource[];
}) {
  return (
    <div className="space-y-4">
      {(data.connections ?? []).map((item: any, i: number) => (
        <Card key={i} className="">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <span>{item.domain}</span>
              <span className="font-semibold text-sm">{item.title}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{item.content}</p>
          </CardContent>
        </Card>
      ))}
      {groundingSources.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <SourcesList sources={groundingSources} label="跨域真实素材" />
          </CardContent>
        </Card>
      )}
      <InsightBox insights={data.insights ?? []} traceId={traceId} sessionId={sessionId} />
    </div>
  );
}

function MirrorResult({
  data,
  traceId,
  sessionId,
}: {
  data: any;
  traceId: string | null;
  sessionId: string | null;
  groundingSources: GroundingSource[];
}) {
  return (
    <div className="space-y-4">
      {(data.figures ?? []).map((item: any, i: number) => (
        <Card key={i} className="">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{item.avatar}</span>
              <div>
                <div className="font-semibold">{item.name}</div>
                <div className="text-xs text-muted-foreground">{item.period}</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed mb-2">{item.story}</p>
            <div className="text-sm font-medium text-amber-700 dark:text-amber-400 italic">
              💡 {item.lesson}
            </div>
            {item.wikipedia_url && (
              <a
                href={item.wikipedia_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                📖 来源: Wikipedia ↗
              </a>
            )}
          </CardContent>
        </Card>
      ))}
      <InsightBox insights={data.insights ?? []} traceId={traceId} sessionId={sessionId} />
    </div>
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ============================================================
// 洞察回流组件
// ============================================================

function InsightBox({
  insights,
  traceId,
  sessionId,
}: {
  insights: string[];
  traceId: string | null;
  sessionId: string | null;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "skipped">(
    "idle"
  );
  const [message, setMessage] = useState("");

  if (!insights.length) return null;

  async function handleFeedback(action: "save" | "skip") {
    if (!sessionId || status === "saving") return;

    setStatus("saving");
    setMessage("");

    try {
      const res = await fetch("/api/think/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          sessionId,
          traceId,
          insights,
        }),
      });

      const payload = await res.json();

      if (!res.ok) {
        throw new Error(payload.error || "保存失败");
      }

      if (action === "save") {
        setStatus("saved");
        setMessage(`已回流 ${payload.savedItemIds?.length ?? 0} 条洞察`);
      } else {
        setStatus("skipped");
        setMessage("已记录本次跳过");
      }
    } catch (error) {
      setStatus("idle");
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  }

  return (
    <div className="border-l-2 pl-4" style={{ borderColor: "var(--flywheel)" }}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <RotateCcw className="h-3.5 w-3.5" style={{ color: "var(--flywheel)" }} />
            回流到记忆层的洞察
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => handleFeedback("skip")}
              disabled={!sessionId || status === "saving" || status === "saved" || status === "skipped"}
            >
              暂不保存
            </Button>
            <Button
              size="sm"
              variant={status === "saved" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => handleFeedback("save")}
              disabled={!sessionId || status === "saving" || status === "saved" || status === "skipped"}
            >
              <BookmarkPlus className="h-3 w-3 mr-1" />
              {status === "saving" ? "保存中..." : status === "saved" ? "已保存 ✓" : "存入记忆"}
            </Button>
          </div>
        </div>
        <ul className="space-y-1">
          {insights.map((insight, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-primary">→</span>
              {insight}
            </li>
          ))}
        </ul>
        {message && (
          <div className="mt-2 text-xs font-medium" style={{ color: "var(--flywheel)" }}>
            {status === "saved"
              ? `飞轮 +1 转 — ${message}`
              : status === "skipped"
                ? message
                : message}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 结果渲染路由
// ============================================================

const RESULT_RENDERERS: Record<
  string,
  React.ComponentType<{
    data: Record<string, unknown>;
    traceId: string | null;
    sessionId: string | null;
    groundingSources: GroundingSource[];
  }>
> = {
  roundtable: RoundtableResult,
  coach: CoachResult,
  crossdomain: CrossDomainResult,
  mirror: MirrorResult,
};

// ============================================================
// 主页面组件
// ============================================================

export default function ThinkPage() {
  const [activeMode, setActiveMode] = useState<ThinkMode>(null);
  const [question, setQuestion] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [thinkPhase, setThinkPhase] = useState("");
  const [result, setResult] = useState<ThinkResultEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleThink() {
    if (!activeMode || !question.trim()) return;
    setIsThinking(true);
    setResult(null);
    setError(null);
    setThinkPhase("连接外脑...");

    try {
      const res = await fetch("/api/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: activeMode, question }),
      });

      const contentType = res.headers.get("content-type") || "";

      // Demo 模式
      if (contentType.includes("application/json")) {
        setIsThinking(false);
        setError("Demo 模式：请配置 AI API Key 以启用真实思考");
        return;
      }

      // SSE 流式响应
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.phase === "done") {
              setResult({
                traceId: payload.traceId ?? null,
                sessionId: payload.sessionId ?? null,
                contextItems: payload.contextItems ?? 0,
                data: payload.result ?? {},
                groundingSources: Array.isArray(payload.groundingSources)
                  ? payload.groundingSources
                  : [],
              });
            } else if (payload.phase === "error") {
              setError(payload.error);
            } else {
              setThinkPhase(payload.phase);
            }
          } catch {
            // 忽略
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setIsThinking(false);
      setThinkPhase("");
    }
  }

  const currentMode = modes.find((m) => m.id === activeMode);

  // Mode selection view
  if (!activeMode) {
    return (
      <div className="flex flex-col gap-8 p-6 max-w-[720px] mx-auto">
        <div>
          <h1 className="text-[30px] font-bold">Think</h1>
          <p className="text-sm text-muted-foreground mt-1">
            选择一种思考模式，让外脑帮你深度思考
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {modes.map((mode) => (
            <Card
              key={mode.id}
              className="cursor-pointer transition-all hover:border-[var(--border-hover,#D4D4D0)] hover:shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
              onClick={() => setActiveMode(mode.id)}
            >
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3">
                  <div className={`p-1.5 rounded-md ${mode.bgColor}`}>
                    <mode.icon className={`h-5 w-5 ${mode.color}`} />
                  </div>
                  <div>
                    <div className="font-semibold text-[15px]">
                      {mode.title}
                      <span className="text-xs font-normal text-muted-foreground ml-1.5">
                        {mode.subtitle}
                      </span>
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-1">{mode.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Active thinking view
  const ResultRenderer = activeMode ? RESULT_RENDERERS[activeMode] : null;

  return (
    <div className="flex flex-col gap-6 p-6 max-w-[720px] mx-auto">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            setActiveMode(null);
            setResult(null);
            setQuestion("");
            setError(null);
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        {currentMode && <currentMode.icon className={`h-4 w-4 ${currentMode.color}`} />}
        <h1 className="text-xl font-semibold">{currentMode?.title}</h1>
      </div>

      {/* Input */}
      <Card>
        <CardContent className="pt-5 pb-5 space-y-3">
          <Textarea
            placeholder={currentMode?.placeholder}
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isThinking}
          />
          <div className="flex justify-end">
            <Button onClick={handleThink} disabled={isThinking || !question.trim()}>
              {isThinking ? "思考中..." : "开始思考"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Thinking Animation — subtle text, no spinner card */}
      {isThinking && (
        <p className="text-sm text-muted-foreground animate-pulse">
          {thinkPhase}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Results */}
      {result && ResultRenderer && (
        <div className="space-y-4">
          {result.contextItems > 0 && (
            <p className="text-xs text-muted-foreground">
              本次思考已引用 {result.contextItems} 条记忆层上下文
            </p>
          )}
          <ResultRenderer
            key={result.sessionId ?? result.traceId ?? "think-result"}
            data={result.data}
            traceId={result.traceId}
            sessionId={result.sessionId}
            groundingSources={result.groundingSources}
          />
        </div>
      )}
    </div>
  );
}

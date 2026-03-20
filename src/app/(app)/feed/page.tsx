"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Rss,
  Link2,
  FileText,
  Send,
  Loader2,
  Check,
  Brain,
  Sparkles,
  Tag,
  GitBranch,
} from "lucide-react";

interface DigestResult {
  id: string;
  input: string;
  type: "url" | "text";
  title: string;
  keyPoints: string[];
  tags: string[];
  domain: string;
  connections: string[];
  timestamp: string;
}

export default function FeedPage() {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [isDigesting, setIsDigesting] = useState(false);
  const [digestPhase, setDigestPhase] = useState("");
  const [results, setResults] = useState<DigestResult[]>([]);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function simulateDigest(input: string, type: "url" | "text") {
    setIsDigesting(true);

    const phases = [
      "🔍 正在读取内容...",
      "🧠 外脑正在理解...",
      "📝 提炼核心观点...",
      "🏷️ 自动打标签...",
      "🔗 搜索历史关联...",
      "✅ 已存入记忆层！",
    ];

    for (const phase of phases) {
      setDigestPhase(phase);
      await new Promise((r) => setTimeout(r, 600));
    }

    const mockResults: Record<string, DigestResult> = {
      url: {
        id: `d-${Date.now()}`,
        input,
        type: "url",
        title: "AI Agents: The Complete Guide to Building Autonomous Systems",
        keyPoints: [
          "Agent = LLM + Memory + Tools + Planning",
          "ReAct 模式是当前最有效的 Agent 架构",
          "Memory 分为短期（对话上下文）和长期（向量数据库）",
          "关键挑战：可靠性、成本控制、评估体系",
        ],
        tags: ["Agent架构", "ReAct", "Memory系统", "LLM"],
        domain: "Agent Building",
        connections: [
          "「AI Agent 的本质是认知外包」— 你3月17日的思考",
          "「跨域洞察：免疫系统 ≈ Agent 架构」— 3月15日的洞察",
        ],
        timestamp: new Date().toLocaleTimeString(),
      },
      text: {
        id: `d-${Date.now()}`,
        input,
        type: "text",
        title: input.slice(0, 30) + (input.length > 30 ? "..." : ""),
        keyPoints: [
          "核心论点：" + input.slice(0, 50),
          "这是一个关于认知升级的思考",
          "与一人公司理念有潜在关联",
        ],
        tags: ["思考", "认知", "方法论"],
        domain: "跨领域",
        connections: [
          "「一人公司的杠杆公式」— 你3月14日的思考",
        ],
        timestamp: new Date().toLocaleTimeString(),
      },
    };

    setResults((prev) => [mockResults[type], ...prev]);
    setIsDigesting(false);
    setDigestPhase("");
    setUrl("");
    setText("");
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Rss className="h-8 w-8" />
          Feed · 喂脑
        </h1>
        <p className="text-muted-foreground mt-2">
          粘贴链接或文本，外脑自动消化并存入记忆
        </p>
      </div>

      {/* Digest Animation */}
      {isDigesting && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-lg font-medium">{digestPhase}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* URL Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="h-5 w-5" />
            粘贴链接
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="https://example.com/article..."
              className="flex-1"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isDigesting}
            />
            <Button
              onClick={() => simulateDigest(url || "https://example.com/ai-agents-guide", "url")}
              disabled={isDigesting}
            >
              <Send className="h-4 w-4 mr-1" />
              消化
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Text Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            粘贴文本 / 记录想法
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            ref={textRef}
            placeholder="粘贴文章内容、记录灵感、或描述你刚读到的有趣观点..."
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={isDigesting}
          />
          <div className="flex justify-end">
            <Button
              onClick={() =>
                simulateDigest(
                  text || "我觉得AI时代最重要的能力不是使用AI工具，而是知道什么问题值得问。提出正确的问题比获得正确的答案更重要。",
                  "text"
                )
              }
              disabled={isDigesting}
            >
              <Send className="h-4 w-4 mr-1" />
              喂给外脑
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Digest Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">消化结果</h2>
          {results.map((result) => (
            <Card key={result.id} className="border-green-200 dark:border-green-900">
              <CardContent className="pt-6 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-green-500" />
                    <span className="font-semibold">{result.title}</span>
                  </div>
                  <Badge variant="outline">{result.domain}</Badge>
                </div>

                {/* Key Points */}
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                    <Brain className="h-4 w-4" />
                    核心观点
                  </div>
                  <ul className="space-y-1.5">
                    {result.keyPoints.map((point, i) => (
                      <li key={i} className="text-sm flex items-start gap-2">
                        <Sparkles className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Tags */}
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                    <Tag className="h-4 w-4" />
                    自动标签
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Connections */}
                {result.connections.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
                      <GitBranch className="h-4 w-4" />
                      发现历史关联！
                    </div>
                    {result.connections.map((conn, i) => (
                      <div key={i} className="text-sm text-amber-600 dark:text-amber-300">
                        → {conn}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {results.length === 0 && !isDigesting && (
        <div className="text-muted-foreground text-center py-12 border rounded-lg border-dashed">
          试试粘贴一个链接或直接点「消化」/「喂给外脑」看效果 🧠
        </div>
      )}
    </div>
  );
}

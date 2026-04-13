"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Rss,
  Link2,
  Send,
  Loader2,
  Check,
  Brain,
  Sparkles,
  Tag,
  GitBranch,
  Paperclip,
  X,
  FileText,
  Image,
  File,
  Zap,
  ArrowLeftRight,
  AlertTriangle,
  MessageSquare,
} from "lucide-react";

interface SparkResult {
  spark: string;
  sourceDomain: string;
  isGeneral: boolean;
}

interface RelationshipResult {
  targetId: string;
  targetTitle: string;
  type: string;
  reason: string;
}

interface DigestResult {
  id: string;
  input: string;
  type: string;
  title: string;
  keyPoints: string[];
  userOpinions?: string[];
  tags: string[];
  domain: string;
  connections: string[];
  relationships?: RelationshipResult[];
  spark?: SparkResult | null;
  timestamp: string;
}

/** 检测 URL 平台 */
function detectPlatform(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("x.com/") || u.includes("twitter.com/")) return "X/Twitter";
  if (u.includes("youtube.com/") || u.includes("youtu.be/")) return "YouTube";
  if (u.includes("mp.weixin.qq.com/")) return "微信公众号";
  if (u.match(/^https?:\/\//)) return "网页";
  return null;
}

/** 检测文件类型图标 */
function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext || "")) return Image;
  if (ext === "pdf") return FileText;
  return File;
}

export default function FeedPage() {
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDigesting, setIsDigesting] = useState(false);
  const [digestPhase, setDigestPhase] = useState("");
  const [results, setResults] = useState<DigestResult[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [extractionError, setExtractionError] = useState<{
    hint: string;
    detail: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValidUrl = url.trim().startsWith("http://") || url.trim().startsWith("https://");
  const detectedPlatform = isValidUrl ? detectPlatform(url) : null;

  async function handleDigest() {
    if (!url.trim() && !note.trim() && !file) return;
    setIsDigesting(true);
    setDigestPhase("正在连接外脑...");
    setExtractionError(null);

    try {
      let res: Response;

      if (file) {
        // 文件上传用 FormData
        const formData = new FormData();
        formData.append("file", file);
        if (note.trim()) formData.append("note", note);
        if (url.trim()) formData.append("url", url);
        res = await fetch("/api/feed", { method: "POST", body: formData });
      } else if (isValidUrl) {
        // URL（可带想法）
        res = await fetch("/api/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: url, type: "url", note }),
        });
      } else {
        // 纯文本（如果 URL 框有非 URL 内容，合并到文本）
        const textInput = [url.trim() && !isValidUrl ? url : "", note]
          .filter(Boolean)
          .join("\n\n");
        res = await fetch("/api/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: textInput, type: "text" }),
        });
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const { result } = await res.json();
        setResults((prev) => [result, ...prev]);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
      } else {
        // SSE
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
                setResults((prev) => [payload.result, ...prev]);
                setShowSuccess(true);
                setTimeout(() => setShowSuccess(false), 3000);
              } else if (payload.phase === "extraction_failed") {
                setDigestPhase("");
                setExtractionError({
                  hint: payload.error,
                  detail: payload.detail,
                });
              } else if (payload.phase === "error") {
                setDigestPhase(`出错: ${payload.error}`);
              } else {
                setDigestPhase(payload.phase);
              }
            } catch {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      console.error("Feed error:", err);
      setDigestPhase("网络错误，请重试");
    } finally {
      setIsDigesting(false);
      setTimeout(() => setDigestPhase(""), 1500);
      setUrl("");
      setNote("");
      setFile(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-[30px] font-bold">Feed</h1>
        <p className="text-sm text-muted-foreground mt-1">
          粘贴链接、输入想法、或上传文件，外脑自动消化并存入记忆
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

      {/* Success Banner */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
          <span className="text-sm font-medium text-green-700 dark:text-green-300">
            消化完成，已存入记忆层
          </span>
        </div>
      )}

      {/* Extraction Failed Banner */}
      {extractionError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-4 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              内容提取失败
            </span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {extractionError.hint}
          </p>
          {extractionError.detail && (
            <p className="text-xs text-amber-600/70 dark:text-amber-400/70">
              原因：{extractionError.detail}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => setExtractionError(null)}
          >
            关闭
          </Button>
        </div>
      )}

      {/* Unified Input Card */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* URL Input */}
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1.5">
              <Link2 className="h-4 w-4" />
              链接（支持 X/Twitter、YouTube、微信公众号、网页）
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="https://..."
                className="flex-1"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isDigesting}
              />
              {detectedPlatform && (
                <Badge variant="secondary" className="shrink-0 self-center">
                  {detectedPlatform}
                </Badge>
              )}
            </div>
          </div>

          {/* Note / Thoughts Input */}
          <div>
            <div className="text-sm text-muted-foreground mb-1.5">
              {isValidUrl ? "你的想法（可选，会和原文一起消化）" : "输入想法或粘贴内容"}
            </div>
            <Textarea
              placeholder={
                url
                  ? "记录你对这篇内容的想法、疑问或启发..."
                  : "粘贴文章内容、记录灵感、或描述一个有趣的观点..."
              }
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isDigesting}
            />
          </div>

          {/* File Upload */}
          {file && (
            <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-2.5">
              {(() => {
                const Icon = getFileIcon(file.name);
                return <Icon className="h-4 w-4 text-muted-foreground" />;
              })()}
              <span className="text-sm flex-1 truncate">{file.name}</span>
              <span className="text-xs text-muted-foreground">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setFile(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.gif,.webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isDigesting}
              >
                <Paperclip className="h-4 w-4 mr-1" />
                上传文件
              </Button>
            </div>

            <Button
              onClick={handleDigest}
              disabled={isDigesting || (!url.trim() && !note.trim() && !file)}
            >
              {isDigesting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  消化中...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  喂给外脑
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Digest Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">消化结果</h2>
          {results.map((result) => (
            <Card key={result.id}>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-green-500" />
                    <span className="font-semibold">{result.title}</span>
                  </div>
                  <Badge variant="outline">{result.domain}</Badge>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                    <Brain className="h-4 w-4" />
                    {result.userOpinions && result.userOpinions.length > 0 ? "文章要点" : "核心观点"}
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

                {result.userOpinions && result.userOpinions.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                      <MessageSquare className="h-4 w-4" />
                      我的观点
                    </div>
                    <ul className="space-y-1.5 pl-0.5">
                      {result.userOpinions.map((opinion, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="h-3.5 w-3.5 mt-0.5 shrink-0 flex items-center justify-center text-blue-500 text-xs font-bold">💭</span>
                          {opinion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

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

                {/* 关系分类结果 */}
                {result.relationships && result.relationships.length > 0 && (
                  <div className="border-l-2 pl-3 mt-2" style={{ borderColor: "var(--flywheel)" }}>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                      <ArrowLeftRight className="h-3 w-3" />
                      知识关联分析
                    </div>
                    {result.relationships.map((rel, i) => (
                      <div key={i} className="text-sm text-muted-foreground flex items-center gap-1.5 mb-1">
                        <Badge
                          variant={rel.type === "contradicts" ? "destructive" : "secondary"}
                          className="text-xs shrink-0"
                        >
                          {rel.type === "supports" ? "支持" : rel.type === "contradicts" ? "矛盾" : rel.type === "extends" ? "扩展" : "不同视角"}
                        </Badge>
                        <span>「{rel.targetTitle}」{rel.reason ? ` — ${rel.reason}` : ""}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 历史关联 (兼容旧格式) */}
                {result.connections.length > 0 && (!result.relationships || result.relationships.length === 0) && (
                  <div className="border-l-2 pl-3 mt-2" style={{ borderColor: "var(--flywheel)" }}>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                      <GitBranch className="h-3 w-3" />
                      发现历史关联
                    </div>
                    {result.connections.map((conn, i) => (
                      <div key={i} className="text-sm text-muted-foreground">
                        {conn}
                      </div>
                    ))}
                  </div>
                )}

                {/* Connection Spark 跨域闪念 */}
                {result.spark && result.spark.spark && (
                  <div className="rounded-lg bg-gradient-to-r from-amber-500/10 to-purple-500/10 border border-amber-500/20 p-3 mt-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 mb-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      跨域闪念
                      {result.spark.isGeneral && (
                        <span className="text-muted-foreground font-normal">
                          (基于通用知识)
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{result.spark.spark}</p>
                    {result.spark.sourceDomain && (
                      <p className="text-xs text-muted-foreground mt-1">
                        灵感来源: {result.spark.sourceDomain}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {results.length === 0 && !isDigesting && (
        <div className="text-muted-foreground text-center py-12 border rounded-lg border-dashed space-y-2">
          <p>粘贴链接、输入想法、或上传文件</p>
          <p className="text-xs">
            支持 X/Twitter · YouTube · 微信公众号 · 网页 · PDF · Word
          </p>
        </div>
      )}
    </div>
  );
}

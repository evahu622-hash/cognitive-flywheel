"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  FileText,
  Lightbulb,
  Sparkles,
  Filter,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  BookOpen,
  AlertTriangle,
  Unlink,
  Clock,
  Eye,
} from "lucide-react";
import { MOCK_KNOWLEDGE, type KnowledgeItem } from "@/lib/mock-data";

const typeConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  article: { label: "阅读", icon: FileText, color: "text-blue-500" },
  thought: { label: "思考", icon: Lightbulb, color: "text-amber-500" },
  insight: { label: "洞察", icon: Sparkles, color: "text-purple-500" },
};

const domainColors: Record<string, string> = {
  投资: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "Agent Building": "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  一人公司: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  健康: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  跨领域: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
};

interface LintReport {
  contradictions: { itemA: { id: string; title: string }; itemB: { id: string; title: string }; reason: string }[];
  orphans: { id: string; title: string; domain: string }[];
  staleItems: { id: string; title: string; daysSinceUpdate: number }[];
  blindSpots: string[];
  totalItems: number;
}

interface DomainSummary {
  id: string;
  domain: string;
  compiled_content: string;
  source_ids: string[];
  version: number;
  last_compiled_at: string;
}

export default function MemoryPage() {
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [items, setItems] = useState<KnowledgeItem[]>(MOCK_KNOWLEDGE);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState({ total: 42, thoughts: 18, connections: 15 });

  // Health Check state
  const [lintReport, setLintReport] = useState<LintReport | null>(null);
  const [isLinting, setIsLinting] = useState(false);
  const [lintError, setLintError] = useState<string | null>(null);

  // Domain Summaries state
  const [summaries, setSummaries] = useState<DomainSummary[]>([]);
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);
  const [compilingDomain, setCompilingDomain] = useState<string | null>(null);

  const runHealthCheck = async () => {
    setIsLinting(true);
    setLintError(null);
    try {
      const res = await fetch("/api/knowledge/lint", { method: "POST" });
      const data = await res.json();
      if (data.message) {
        setLintError(data.message);
      } else {
        setLintReport(data);
      }
    } catch {
      setLintError("健康检查失败，请重试");
    } finally {
      setIsLinting(false);
    }
  };

  const compileDomain = async (domain: string) => {
    setCompilingDomain(domain);
    try {
      const res = await fetch("/api/knowledge/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (data.compiled_content) {
        setSummaries((prev) => {
          const filtered = prev.filter((s) => s.domain !== domain);
          return [...filtered, data as DomainSummary];
        });
      }
    } catch {
      // silent fail
    } finally {
      setCompilingDomain(null);
    }
  };

  // Fetch existing summaries
  useEffect(() => {
    fetch("/api/knowledge?summaries=true")
      .then((r) => r.json())
      .then((data) => {
        if (data.summaries) setSummaries(data.summaries);
      })
      .catch(() => {});
  }, []);

  const domains = ["投资", "Agent Building", "一人公司", "健康", "跨领域"];

  const fetchKnowledge = useCallback(async (searchTerm: string, domain: string | null) => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      if (domain) params.set("domain", domain);
      const res = await fetch(`/api/knowledge?${params}`);
      const data = await res.json();
      // 标准化字段名（Supabase 返回 snake_case，mock 用 camelCase）
      const normalized = (data.items ?? []).map((item: Record<string, unknown>) => ({
        ...item,
        createdAt: item.createdAt ?? item.created_at ?? "",
        connections: item.connections ?? [],
        sourceUrl: item.sourceUrl ?? item.source_url ?? null,
        rawContent: item.rawContent ?? item.raw_content ?? null,
      })) as KnowledgeItem[];
      setItems(normalized);
    } catch {
      // API 失败时保留当前数据
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 加载统计数据
  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.stats) {
          setStats({
            total: data.stats.totalKnowledge,
            thoughts: data.stats.totalThoughts,
            connections: data.stats.totalConnections,
          });
        }
      })
      .catch(() => {});
  }, []);

  // 搜索和筛选 debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchKnowledge(search, activeDomain);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, activeDomain, fetchKnowledge]);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-[30px] font-bold">Memory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          你的知识库全局视图——所有读过的、想过的、学过的
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索记忆...（关键词优先，语义检索增强）"
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">知识条目</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">{stats.thoughts}</div>
            <div className="text-sm text-muted-foreground">思考记录</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">{stats.connections}</div>
            <div className="text-sm text-muted-foreground">跨域关联</div>
          </CardContent>
        </Card>
      </div>

      {/* Health Check + Domain Summaries */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <HeartPulse className="h-4 w-4" />
            知识健康检查
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={runHealthCheck}
            disabled={isLinting}
          >
            {isLinting ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />检查中...</>
            ) : (
              <><HeartPulse className="h-3.5 w-3.5 mr-1" />运行检查</>
            )}
          </Button>
        </div>

        {lintError && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-4 text-sm text-muted-foreground">{lintError}</CardContent>
          </Card>
        )}

        {lintReport && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="text-sm font-medium">
                检查完成 ({lintReport.totalItems} 条知识)
              </div>

              {lintReport.contradictions.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-red-500 mb-1">
                    <AlertTriangle className="h-3 w-3" />
                    发现 {lintReport.contradictions.length} 组矛盾
                  </div>
                  {lintReport.contradictions.map((c, i) => (
                    <div key={i} className="text-sm text-muted-foreground ml-4 mb-1">
                      「{c.itemA.title}」vs「{c.itemB.title}」— {c.reason}
                    </div>
                  ))}
                </div>
              )}

              {lintReport.orphans.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500 mb-1">
                    <Unlink className="h-3 w-3" />
                    {lintReport.orphans.length} 条孤立知识
                  </div>
                  <div className="text-sm text-muted-foreground ml-4">
                    {lintReport.orphans.map((o) => `「${o.title}」`).join("、")}
                  </div>
                </div>
              )}

              {lintReport.staleItems.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
                    <Clock className="h-3 w-3" />
                    {lintReport.staleItems.length} 条可能过时
                  </div>
                  <div className="text-sm text-muted-foreground ml-4">
                    {lintReport.staleItems.map((s) => `「${s.title}」(${s.daysSinceUpdate}天)`).join("、")}
                  </div>
                </div>
              )}

              {lintReport.blindSpots.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-purple-500 mb-1">
                    <Eye className="h-3 w-3" />
                    知识盲区
                  </div>
                  <ul className="text-sm text-muted-foreground ml-4 space-y-0.5">
                    {lintReport.blindSpots.map((b, i) => (
                      <li key={i}>- {b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {lintReport.contradictions.length === 0 &&
                lintReport.orphans.length === 0 &&
                lintReport.staleItems.length === 0 &&
                lintReport.blindSpots.length === 0 && (
                <div className="text-sm text-green-600">知识库健康状态良好!</div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Domain Summaries */}
        {summaries.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="h-4 w-4" />
              领域综述
            </div>
            {summaries.map((s) => (
              <Card key={s.id} className="cursor-pointer" onClick={() => setExpandedSummary(expandedSummary === s.id ? null : s.id)}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{s.domain}</Badge>
                      <span className="text-xs text-muted-foreground">
                        v{s.version} · {s.source_ids.length} 篇来源 · {new Date(s.last_compiled_at).toLocaleDateString("zh-CN")}
                      </span>
                    </div>
                    {expandedSummary === s.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </div>
                  {expandedSummary === s.id && (
                    <div className="mt-3 pt-3 border-t text-sm text-muted-foreground whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {s.compiled_content}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Domain Filter */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" />
          按领域筛选
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={activeDomain === null ? "default" : "outline"}
            onClick={() => setActiveDomain(null)}
          >
            全部
          </Button>
          {domains.map((domain) => (
            <Button
              key={domain}
              size="sm"
              variant={activeDomain === domain ? "default" : "outline"}
              onClick={() => setActiveDomain(activeDomain === domain ? null : domain)}
            >
              {domain}
            </Button>
          ))}
        </div>
      </div>

      {/* Knowledge Items */}
      <div className="space-y-3">
        {items.map((item) => {
          const config = typeConfig[item.type] ?? typeConfig.article;
          const isExpanded = expandedId === item.id;

          return (
            <Card
              key={item.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setExpandedId(isExpanded ? null : item.id)}
            >
              <CardContent className="pt-4">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <config.icon className={`h-4 w-4 ${config.color}`} />
                    <Badge variant="outline" className="text-xs">
                      {config.label}
                    </Badge>
                    <span className="font-semibold text-sm">{item.title}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${domainColors[item.domain] || ""}`}>
                    {item.domain}
                  </span>
                </div>

                {/* Summary */}
                <p className="text-sm text-muted-foreground mb-2">{item.summary}</p>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(item.tags ?? []).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>

                {/* Expanded: raw content + source link */}
                {isExpanded && (() => {
                  const ext = item as unknown as Record<string, unknown>;
                  const sourceUrl = ext.sourceUrl as string | null;
                  const rawContent = ext.rawContent as string | null;
                  return (
                    <div className="mt-3 pt-3 border-t space-y-3">
                      {sourceUrl && (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm hover:underline"
                          style={{ color: "var(--flywheel)" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          查看原文
                        </a>
                      )}
                      {rawContent && (
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">原文内容</div>
                          <div className="text-sm text-muted-foreground bg-muted/50 rounded p-3 max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                            {rawContent.slice(0, 2000)}
                            {rawContent.length > 2000 && "..."}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Date + expand indicator */}
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                  <span>{item.createdAt}</span>
                  <span className="flex items-center gap-1">
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {isExpanded ? "收起" : "展开详情"}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {items.length === 0 && !isLoading && (
          <div className="text-muted-foreground text-center py-12 border rounded-lg border-dashed">
            没有找到匹配的记忆
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Database,
  Search,
  FileText,
  Lightbulb,
  Sparkles,
  GitBranch,
  Filter,
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

export default function MemoryPage() {
  const [search, setSearch] = useState("");
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const domains = ["投资", "Agent Building", "一人公司", "健康", "跨领域"];

  const filtered = MOCK_KNOWLEDGE.filter((item) => {
    const matchesSearch =
      !search ||
      item.title.toLowerCase().includes(search.toLowerCase()) ||
      item.summary.toLowerCase().includes(search.toLowerCase()) ||
      item.tags.some((t) => t.includes(search));
    const matchesDomain = !activeDomain || item.domain === activeDomain;
    return matchesSearch && matchesDomain;
  });

  function getConnectedItems(item: KnowledgeItem) {
    return MOCK_KNOWLEDGE.filter((k) => item.connections.includes(k.id));
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Database className="h-8 w-8" />
          Memory · 记忆宫殿
        </h1>
        <p className="text-muted-foreground mt-2">
          你的知识库全局视图——所有读过的、想过的、学过的
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索记忆...（试试搜'杠杆'或'Agent'）"
          className="pl-10"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">42</div>
            <div className="text-sm text-muted-foreground">知识条目</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">18</div>
            <div className="text-sm text-muted-foreground">思考记录</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">15</div>
            <div className="text-sm text-muted-foreground">跨域关联</div>
          </CardContent>
        </Card>
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
        {filtered.map((item) => {
          const config = typeConfig[item.type];
          const connected = getConnectedItems(item);
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
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>

                {/* Connections (expanded) */}
                {isExpanded && connected.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-2">
                      <GitBranch className="h-4 w-4" />
                      关联知识
                    </div>
                    {connected.map((conn) => (
                      <div key={conn.id} className="text-sm bg-muted/50 rounded p-2 mb-1">
                        → {conn.title}
                        <span className="text-xs text-muted-foreground ml-2">({conn.domain})</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Date & connection count */}
                <div className="flex items-center justify-between text-xs text-muted-foreground mt-2">
                  <span>{item.createdAt}</span>
                  {connected.length > 0 && (
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {connected.length} 个关联 {isExpanded ? "▲" : "▼"}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-muted-foreground text-center py-12 border rounded-lg border-dashed">
            没有找到匹配的记忆 🔍
          </div>
        )}
      </div>
    </div>
  );
}

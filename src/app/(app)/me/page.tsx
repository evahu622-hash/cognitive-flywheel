"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Target,
  TrendingUp,
  AlertTriangle,
  RotateCcw,
  BookOpen,
  Lightbulb,
  GitBranch,
  ArrowUp,
  Zap,
} from "lucide-react";
import { COGNITIVE_PROFILE } from "@/lib/mock-data";

export default function MePage() {
  const p = COGNITIVE_PROFILE;
  const maxGrowth = Math.max(...p.recentGrowth.map((d) => d.items));

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <User className="h-8 w-8" />
          Me · 认知画像
        </h1>
        <p className="text-muted-foreground mt-2">
          你的知识地图、盲区地图、成长曲线
        </p>
      </div>

      {/* Flywheel Status - Hero Card */}
      <Card className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-primary/20">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <RotateCcw className="h-5 w-5 text-primary" />
                <span className="font-semibold text-lg">认知飞轮状态</span>
              </div>
              <p className="text-sm text-muted-foreground">
                输入 → 记忆 → 思考 → 洞察 → 回流
              </p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-primary">{p.flywheelTurns}</div>
              <div className="text-sm text-muted-foreground">飞轮转数</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">知识条目</span>
            </div>
            <div className="text-3xl font-bold">{p.totalKnowledge}</div>
            <div className="flex items-center gap-1 text-xs text-green-500 mt-1">
              <ArrowUp className="h-3 w-3" />
              +5 本周
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">思考记录</span>
            </div>
            <div className="text-3xl font-bold">{p.totalThoughts}</div>
            <div className="flex items-center gap-1 text-xs text-green-500 mt-1">
              <ArrowUp className="h-3 w-3" />
              +3 本周
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="h-4 w-4 text-purple-500" />
              <span className="text-sm text-muted-foreground">跨域关联</span>
            </div>
            <div className="text-3xl font-bold">{p.totalConnections}</div>
            <div className="flex items-center gap-1 text-xs text-green-500 mt-1">
              <ArrowUp className="h-3 w-3" />
              +2 本周
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Domain Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-5 w-5 text-blue-500" />
              知识领域分布
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.domains.map((domain) => {
              const maxCount = Math.max(...p.domains.map((d) => d.count));
              const pct = (domain.count / maxCount) * 100;
              return (
                <div key={domain.name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{domain.name}</span>
                    <span className="text-muted-foreground">{domain.count} 条</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: domain.color }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Growth Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-5 w-5 text-green-500" />
              近7天成长曲线
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {p.recentGrowth.map((day) => {
                const height = (day.items / maxGrowth) * 100;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium">{day.items}</span>
                    <div
                      className="w-full bg-primary/80 rounded-t transition-all duration-500 min-h-[4px]"
                      style={{ height: `${height}%` }}
                    />
                    <span className="text-xs text-muted-foreground">{day.date}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Blind Spots */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              盲区地图
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {p.blindSpots.map((spot, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2.5"
                >
                  <span className="text-amber-500 shrink-0">⚠️</span>
                  <span>{spot}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              去思考室的「认知教练」获取个性化学习路径 →
            </p>
          </CardContent>
        </Card>

        {/* Recent Achievements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5 text-primary" />
              最近成就
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                {
                  emoji: "🔗",
                  text: "首次跨域连接：免疫系统 × Agent 架构",
                  date: "3月15日",
                },
                {
                  emoji: "🎯",
                  text: "完成第一次圆桌会议",
                  date: "3月18日",
                },
                {
                  emoji: "📚",
                  text: "知识条目突破 40",
                  date: "3月19日",
                },
                {
                  emoji: "🔄",
                  text: "飞轮连续运转 7 天",
                  date: "今天",
                },
              ].map((achievement, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>
                    {achievement.emoji} {achievement.text}
                  </span>
                  <span className="text-xs text-muted-foreground">{achievement.date}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { Brain, ArrowRight, Users, GraduationCap, Shuffle, History, MessageSquare, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";

const comparisonColumns = [
  {
    icon: MessageSquare,
    title: "传统 AI",
    points: [
      "每次对话从零开始",
      "知识散落在聊天记录里",
      "被动回答，不会主动连接",
    ],
    highlighted: false,
  },
  {
    icon: BookOpen,
    title: "知识维基 (Wiki)",
    points: [
      "编译知识，不再从零开始",
      "结构化存储，交叉引用",
      "整理知识，但不帮你思考",
    ],
    highlighted: false,
  },
  {
    icon: Brain,
    title: "认知飞轮",
    points: [
      "编译 + 主动连接 + 深度思考",
      "知识越多，洞察越深",
      "圆桌会议、盲区发现、跨域类比",
    ],
    highlighted: true,
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="max-w-3xl w-full text-center space-y-12">
        {/* Hero */}
        <div className="space-y-6">
          <Brain className="h-10 w-10 mx-auto" style={{ color: "var(--flywheel)" }} />

          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">
              Cognitive Flywheel
            </h1>
            <p className="text-base text-muted-foreground">认知飞轮</p>
          </div>

          <div className="space-y-2">
            <p className="text-lg font-medium">
              你的 AI 不只是搜索，它记忆、连接、思考。
            </p>
            <p className="text-sm text-muted-foreground/80 max-w-lg mx-auto">
              大多数 AI 工具每次都从零开始推导。认知飞轮编译你的知识，保持更新，帮你从多个视角思考。
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="flex gap-3 justify-center">
          <Link href="/feed">
            <Button className="gap-2">
              开始喂脑
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/think">
            <Button variant="outline">
              进入思考室
            </Button>
          </Link>
        </div>

        {/* How it's different */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            有什么不同
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {comparisonColumns.map(({ icon: Icon, title, points, highlighted }) => (
              <Card
                key={title}
                className={
                  highlighted
                    ? "border-2 border-[var(--flywheel)] bg-[var(--flywheel)]/5"
                    : ""
                }
              >
                <CardContent className="pt-6 space-y-4">
                  <div className="flex flex-col items-center gap-2">
                    <Icon
                      className="h-5 w-5"
                      style={highlighted ? { color: "var(--flywheel)" } : undefined}
                    />
                    <h3 className="font-semibold text-base">{title}</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-muted-foreground text-left">
                    {points.map((point) => (
                      <li key={point} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* 4 capabilities */}
        <div className="grid grid-cols-4 gap-6 pt-4">
          {[
            { icon: Users, label: "圆桌会议" },
            { icon: GraduationCap, label: "认知教练" },
            { icon: Shuffle, label: "跨域连接" },
            { icon: History, label: "历史镜鉴" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <Icon className="h-4 w-4" />
              <span className="text-xs">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

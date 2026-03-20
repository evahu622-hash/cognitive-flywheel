"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, Users, GraduationCap, Shuffle, History } from "lucide-react";
import Link from "next/link";

const thinkModes = [
  {
    id: "roundtable",
    title: "圆桌会议",
    subtitle: "Roundtable",
    description: "召集多位专家从不同视角挑战和完善你的想法",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950",
  },
  {
    id: "coach",
    title: "认知教练",
    subtitle: "Cognitive Coach",
    description: "发现你的知识盲区，生成个性化学习路径",
    icon: GraduationCap,
    color: "text-green-500",
    bgColor: "bg-green-50 dark:bg-green-950",
  },
  {
    id: "crossdomain",
    title: "跨域连接",
    subtitle: "Cross-Domain",
    description: "从其他领域借鉴灵感，发现意想不到的类比",
    icon: Shuffle,
    color: "text-purple-500",
    bgColor: "bg-purple-50 dark:bg-purple-950",
  },
  {
    id: "mirror",
    title: "历史镜鉴",
    subtitle: "History Mirror",
    description: "先驱们遇到过同样的问题，看看他们怎么做的",
    icon: History,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-950",
  },
];

export default function ThinkPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Lightbulb className="h-8 w-8" />
          Think · 思考室
        </h1>
        <p className="text-muted-foreground mt-2">
          选择一种思考模式，让外脑帮你深度思考
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {thinkModes.map((mode) => (
          <Link key={mode.id} href={`/think/${mode.id}`}>
            <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
              <CardHeader>
                <div
                  className={`w-12 h-12 rounded-lg ${mode.bgColor} flex items-center justify-center mb-2`}
                >
                  <mode.icon className={`h-6 w-6 ${mode.color}`} />
                </div>
                <CardTitle>
                  {mode.title}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    {mode.subtitle}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{mode.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { Brain, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="max-w-2xl text-center space-y-8">
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Brain className="h-10 w-10 text-primary" />
          </div>
        </div>

        <div>
          <h1 className="text-5xl font-bold tracking-tight">
            Cognitive Flywheel
          </h1>
          <p className="text-xl text-muted-foreground mt-3">认知飞轮</p>
        </div>

        <p className="text-lg text-muted-foreground leading-relaxed">
          这不是一个工具，是一个和你一起成长的外脑。
          <br />
          输入 → 记忆 → 思考 → 洞察 → 回流，每转一圈，外脑更懂你。
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/feed">
            <Button size="lg" className="gap-2">
              开始喂脑
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/think">
            <Button size="lg" variant="outline" className="gap-2">
              进入思考室
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-4 pt-8 text-sm text-muted-foreground">
          <div>🔄 圆桌会议</div>
          <div>🎯 认知教练</div>
          <div>🔀 跨域连接</div>
          <div>📜 历史镜鉴</div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Rss, Link2, FileText, Send } from "lucide-react";

export default function FeedPage() {
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
            <Input placeholder="https://..." className="flex-1" />
            <Button>
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
            placeholder="粘贴文章内容、记录灵感、或描述你刚读到的有趣观点..."
            rows={6}
          />
          <div className="flex justify-end">
            <Button>
              <Send className="h-4 w-4 mr-1" />
              喂给外脑
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent Feed */}
      <div>
        <h2 className="text-xl font-semibold mb-3">最近输入</h2>
        <div className="text-muted-foreground text-center py-12 border rounded-lg border-dashed">
          还没有任何输入，开始喂脑吧 🧠
        </div>
      </div>
    </div>
  );
}

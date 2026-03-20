"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function MemoryPage() {
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
        <Input placeholder="搜索记忆..." className="pl-10" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">0</div>
            <div className="text-sm text-muted-foreground">知识条目</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">0</div>
            <div className="text-sm text-muted-foreground">思考记录</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="text-3xl font-bold">0</div>
            <div className="text-sm text-muted-foreground">跨域关联</div>
          </CardContent>
        </Card>
      </div>

      {/* Knowledge Tags */}
      <Card>
        <CardHeader>
          <CardTitle>知识领域</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">投资</Badge>
            <Badge variant="outline">Agent Building</Badge>
            <Badge variant="outline">健康</Badge>
            <Badge variant="outline">一人公司</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Empty State */}
      <div className="text-muted-foreground text-center py-12 border rounded-lg border-dashed">
        记忆宫殿是空的，去 Feed 页喂点知识进来吧 🧠
      </div>
    </div>
  );
}

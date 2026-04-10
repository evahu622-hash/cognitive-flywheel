"use client";

import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-4">
        <Brain
          className="h-8 w-8 mx-auto"
          style={{ color: "var(--flywheel)" }}
        />
        <h1 className="text-2xl font-bold">暂未开放注册</h1>
        <p className="text-sm text-muted-foreground">
          认知飞轮目前处于内测阶段，敬请期待。
        </p>
        <Button variant="outline" onClick={() => router.push("/auth/login")}>
          返回登录
        </Button>
      </div>
    </div>
  );
}

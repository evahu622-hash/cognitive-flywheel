"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Brain, Rss, Database, Lightbulb, User, RefreshCw, LogOut, FlaskConical } from "lucide-react";
import { createBrowserSupabase } from "@/lib/supabase";

const navItems = [
  { title: "Feed", subtitle: "喂脑", href: "/feed", icon: Rss },
  { title: "Memory", subtitle: "记忆宫殿", href: "/memory", icon: Database },
  { title: "Think", subtitle: "思考室", href: "/think", icon: Lightbulb },
  { title: "Evals", subtitle: "评估台", href: "/evals", icon: FlaskConical },
  { title: "Me", subtitle: "认知画像", href: "/me", icon: User },
];

export function AppSidebar({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <Brain className="h-5 w-5" style={{ color: "var(--flywheel)" }} />
          <span className="text-sm font-semibold">Cognitive Flywheel</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton isActive={pathname === item.href}>
                <Link href={item.href} className="flex items-center gap-2 w-full">
                  <item.icon className="h-4 w-4" />
                  <span className="text-[13px]">{item.title}</span>
                  <span className="text-[11px] text-muted-foreground">{item.subtitle}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3" style={{ color: "var(--flywheel)" }} />
          <span>认知飞轮</span>
        </div>
        {userEmail && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground truncate max-w-[160px]">
              {userEmail}
            </span>
            <button
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="登出"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

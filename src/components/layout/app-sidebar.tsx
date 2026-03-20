"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Brain, Rss, Database, Lightbulb, User } from "lucide-react";

const navItems = [
  { title: "Feed · 喂脑", href: "/feed", icon: Rss },
  { title: "Memory · 记忆宫殿", href: "/memory", icon: Database },
  { title: "Think · 思考室", href: "/think", icon: Lightbulb },
  { title: "Me · 认知画像", href: "/me", icon: User },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/" className="flex items-center gap-2">
          <Brain className="h-6 w-6" />
          <span className="text-lg font-bold">Cognitive Flywheel</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton isActive={pathname === item.href}>
                <Link href={item.href} className="flex items-center gap-2 w-full">
                  <item.icon className="h-4 w-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  );
}

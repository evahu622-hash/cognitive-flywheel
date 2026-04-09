"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Rss, Database, Lightbulb, User, FlaskConical } from "lucide-react";

const allNavItems = [
  { href: "/feed", icon: Rss, label: "Feed" },
  { href: "/memory", icon: Database, label: "Memory" },
  { href: "/think", icon: Lightbulb, label: "Think" },
  { href: "/evals", icon: FlaskConical, label: "Evals", devOnly: true },
  { href: "/me", icon: User, label: "Me" },
];

const navItems = allNavItems.filter(
  (item) => !item.devOnly || process.env.NEXT_PUBLIC_DEV_MODE === "true"
);

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background md:hidden">
      <div className="flex items-center justify-around h-14">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 text-xs transition-colors ${
                isActive
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" style={isActive ? { color: "var(--flywheel)" } : undefined} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

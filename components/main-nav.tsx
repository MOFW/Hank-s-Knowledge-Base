"use client";

import { AppLink } from "@/components/app-link";
import { BookOpen, House, Inbox, ListChecks, Search, RotateCcw } from "lucide-react";
import { routeSection } from "./route-loading";
import { useRouteTransition } from "./route-transition";

const items = [
  { href: "/", label: "学习台", icon: House },
  { href: "/courses", label: "课程", icon: BookOpen },
  { href: "/questions", label: "题库", icon: ListChecks },
  { href: "/imports", label: "导入与操作", icon: Inbox },
  { href: "/review", label: "复习", icon: RotateCcw },
  { href: "/search", label: "搜索", icon: Search },
];

export function MainNav() {
  const { path, navigate } = useRouteTransition();
  const section = routeSection(path);
  return <nav aria-label="主导航">{items.map(({ href, label, icon: Icon }) => {
    const current = section === href;
    return <AppLink key={href} href={href} aria-current={current ? "page" : undefined}
      onNavigate={href === "/imports" ? (event) => {
        // MCP proposals can arrive while this tab is open.
        event.preventDefault();
        navigate(href, { revalidate: true });
      } : undefined}>
      <Icon size={16} aria-hidden="true" /><span>{label}</span>
      {current && <span className="nav-indicator" aria-hidden="true" />}
    </AppLink>;
  })}</nav>;
}

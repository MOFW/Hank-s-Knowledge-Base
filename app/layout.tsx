import { AppLink } from "@/components/app-link";
import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./motion.css";
import "./library.css";
import "@/components/reading.css";
import "@/components/questions.css";
import "@/components/editing.css";
import "@/components/review.css";
import { ThemeControl } from "@/components/theme";
import { MainNav } from "@/components/main-nav";
import { RouteTransition } from "@/components/route-transition";
import { SaveNotice } from "@/components/save-notice";

export const metadata: Metadata = {
  title: { default: "Hank’s Knowledge Base", template: "%s · Hank’s Knowledge Base" },
  description: "Hank 的课程目录、学习笔记、个人题库和复习中心。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: 'try{var t=localStorage.getItem("hkb-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch{}' }} /></head>
      <body>
        <a className="skip-link" href="#main">跳到正文</a>
        <RouteTransition header={<header className="site-header">
          <div className="header-inner">
            <AppLink className="brand" href="/" aria-label="Hank’s Knowledge Base 首页"><span className="brand-icon"><BookOpen size={19} aria-hidden="true" /></span><span>Hank’s Knowledge Base</span></AppLink>
            <MainNav />
            <ThemeControl />
          </div>
        </header>}>{children}</RouteTransition>
        <SaveNotice />
      </body>
    </html>
  );
}

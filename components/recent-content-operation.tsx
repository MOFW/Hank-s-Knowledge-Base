"use client";

import { useRouter } from "next/navigation";
import { AppLink } from "@/components/app-link";
import { useSave } from "@/components/use-save";
import type { ContentChange } from "@/domain/content-operations";

const labels: Record<ContentChange["kind"], string> = {
  course: "课程", chapter: "章节", topic: "笔记", question: "题目", attempt: "作答", learning: "学习记录", asset: "附件",
};
const actions = { create: "新增", update: "更新", delete: "删除" };

export function RecentContentOperation({ latest, timestamp }: {
  latest: { operationId: string; changes: ContentChange[]; canUndo: boolean } | null;
  timestamp?: string;
}) {
  const router = useRouter();
  const { save, error, pending, disabled, succeeded } = useSave("/api/v1/content-operations", undefined, "DELETE");
  if (!latest) return <section className="section"><h2>最近一次内容操作</h2><p className="empty">暂无可撤销的操作。</p></section>;
  return <section className="section">
    <h2>最近一次内容操作</h2>
    <p className="field-hint">{timestamp} · {latest.changes.length} 项变更</p>
    <ul>{latest.changes.map(({ id, kind, action, href, title }, index) => {
      const label = `${actions[action]}${labels[kind]}${title ? ` · ${title}` : ""}`;
      return <li key={`${kind}-${id}-${action}-${index}`}>
        {href ? <AppLink className="text-link" href={href}>{label}</AppLink> : <span>{label}</span>}
      </li>;
    })}</ul>
    {!latest.canUndo ? <p className="field-hint">相关资料已更新，这轮操作无法撤销。</p>
      : <button type="button" className="button" disabled={disabled || succeeded} onClick={async () => {
        if (await save({ operationId: latest.operationId })) router.refresh();
      }}>{pending ? "正在撤销…" : "撤销这一轮"}</button>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {succeeded && <p role="status">已撤销这一轮。</p>}
  </section>;
}

"use client";

import { AppLink } from "@/components/app-link";
import { ArrowRight } from "lucide-react";
import type { StartReview } from "@/domain/review";
import { useSave } from "@/components/use-save";
import { useNavigateAfterSave } from "@/components/save-notice";

export function StartReviewButton({ input, label }: { input: StartReview; label: string }) {
  const navigateAfterSave = useNavigateAfterSave();
  const { disabled, pending, error, save } = useSave("/api/v1/review/sessions");
  return <div className="review-launch">
    <button className="button primary" type="button" disabled={disabled} onClick={async () => {
      const saved = await save(input);
      if (saved) navigateAfterSave(`/review/${saved.id}`, "复习已准备好");
    }}>{pending ? "正在准备…" : label}<ArrowRight size={16} aria-hidden="true" /></button>
    {error && <p className="save-error" role="alert">{error}</p>}
  </div>;
}

export function ReviewEntry({ entry, input, showHistory = false }: {
  entry: { open: { id: string; position: number; total: number } | null; latest: { id: string } | null; due: number };
  input: StartReview;
  showHistory?: boolean;
}) {
  return <div className="review-entry">
    {entry.open ? <AppLink className="button primary" href={`/review/${entry.open.id}`}>
      继续复习 · 第 {entry.open.position}/{entry.open.total} 题<ArrowRight size={16} aria-hidden="true" />
    </AppLink> : entry.due > 0 ? <StartReviewButton input={input} label={`开始复习 · 本轮 ${entry.due} 题`} />
      : <p className="empty">当前范围暂无可开始的复习题目。</p>}
    {showHistory && !entry.open && entry.latest && <AppLink className="text-link" href={`/review/${entry.latest.id}`}>上轮结果</AppLink>}
  </div>;
}

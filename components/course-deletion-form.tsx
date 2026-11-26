"use client";

import { useState, type FormEvent } from "react";
import { ConfirmActions } from "./management-form";
import { useNavigateAfterSave } from "./save-notice";
import { useSave } from "./use-save";

export function CourseDeletionForm({ id, dataEpoch, hasContent, exclusive }: {
  id: string; dataEpoch: number; hasContent: boolean; exclusive: { notes: number; questions: number };
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const [mode, setMode] = useState<"keep" | "purge">("keep");
  const [confirming, setConfirming] = useState(false);
  const { save, disabled, pending, error } = useSave(`/api/v1/courses/${id}`, undefined, "DELETE");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "purge" && exclusive.notes + exclusive.questions >= 10 && !confirming) {
      setConfirming(true);
      return;
    }
    if (await save({ dataEpoch, mode })) navigateAfterSave("/courses", "课程已删除");
  }
  return <form method="post" className="course-deletion-form" onSubmit={submit} aria-busy={pending}>
    <fieldset disabled={disabled || confirming}>
      {hasContent && <div className="management-choices">
        <label className="check-field"><input type="radio" name="course-delete-mode" checked={mode === "keep"}
          onChange={() => setMode("keep")} />仅删除课程，保留内容</label>
        <label className="check-field"><input type="radio" name="course-delete-mode" checked={mode === "purge"}
          onChange={() => setMode("purge")} />删除课程及其专属内容</label>
      </div>}
      {mode === "keep" && hasContent && <p>笔记和主课程题目移至未归类，保留原链接、历史、题目关系和学习记录。</p>}
      {mode === "purge" && <p>同时删除 {exclusive.notes} 篇专属笔记、{exclusive.questions} 道专属题目及其历史和学习记录。共享内容进入未归类。</p>}
    </fieldset>
    {confirming && <p>永久删除课程、专属内容及其学习记录？</p>}
    <ConfirmActions label={confirming ? "确认永久删除" : "删除课程"} cancelHref={`/courses/${id}`}
      cancelAction={confirming ? () => setConfirming(false) : undefined} pending={pending} error={error} disabled={disabled} />
  </form>;
}

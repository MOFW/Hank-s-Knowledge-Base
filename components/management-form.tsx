"use client";

import { AppLink } from "@/components/app-link";
import { useState, type FormEvent, type ReactNode } from "react";
import type { ManagementInput } from "@/domain/management";
import type { TopicCourse } from "./catalog-forms";
import { useNavigateAfterSave } from "./save-notice";
import { useSave } from "./use-save";
import { ChapterPicker } from "./chapter-picker";

export function ConfirmActions({ label, cancelHref, cancelAction, pending, disabled, error, danger = true }: {
  label: string; cancelHref: string; cancelAction?: () => void; pending: boolean; disabled: boolean; error: string; danger?: boolean;
}) {
  return <>
    <div className="actions">
      <button type="submit" className={danger ? "button danger" : "button primary"} disabled={disabled}>
        {pending ? "正在处理…" : label}
      </button>
      {!pending && (cancelAction ? <button className="button" type="button" onClick={cancelAction}>取消</button>
        : <AppLink className="button" href={cancelHref}>取消</AppLink>)}
    </div>
    {error && <p role="alert">{error}</p>}
  </>;
}

export type ManagementChoice = {
  action: ManagementInput["action"];
  label: string;
  description: ReactNode;
  selectItems?: boolean;
  placement?: boolean;
  renameFrom?: string;
};

export function ManagementForm({ url, dataEpoch, cancelHref, completeHref, choices, items = [],
  courses = [], initialCourseId = null }: {
  url: string; dataEpoch: number; cancelHref: string; completeHref: string;
  choices: ManagementChoice[];
  items?: { id: string; title: string; status: string }[];
  courses?: TopicCourse[]; initialCourseId?: string | null;
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const [action, setAction] = useState(choices[0].action);
  const choice = choices.find((item) => item.action === action) ?? choices[0];
  const [courseId, setCourseId] = useState(initialCourseId);
  const [chosen, setChosen] = useState<string[]>([]);
  const { save, pending, disabled, error } = useSave(url);
  const statusLabels: Record<string, string> = {
    pending: "待审核", approved: "待入库", rejected: "已拒绝", skipped: "已跳过", conflict: "有冲突", failed: "提交失败", committed: "已入库",
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const placement = choice.placement ? { courseId, chapterId: form.get("chapterId") || null } : {};
    const saved = await save({ dataEpoch, action, ...placement,
      ...(action === "rename" && { title: form.get("title") }),
      ...(choice.selectItems && { itemIds: chosen }) });
    if (saved) {
      const destination = action === "move" && courseId ? `/courses/${courseId}` : completeHref;
      const messages = { move: "已移动", restore: "已恢复", reset: "复习进度已重置", cancel: "任务已取消", rename: "章节已重命名" };
      const message = messages[action as keyof typeof messages] ?? "已删除";
      navigateAfterSave(destination, message);
    }
  }

  return <form method="post" onSubmit={submit} className="panel-content" aria-busy={pending}>
    <fieldset disabled={disabled}>
      {choices.length > 1 && <div className="management-choices">{choices.map((item) =>
        <label className="check-field" key={item.action}>
          <input type="radio" name="management-action" checked={action === item.action} onChange={() => setAction(item.action)} />
          {item.label}
        </label>)}</div>}
      <p>{choice.description}</p>
      {action === "rename" && <label>章节名称<input name="title" required maxLength={120} defaultValue={choice.renameFrom} /></label>}
      {choice.placement && <>
        <label>目标课程<select value={courseId ?? ""} onChange={(event) => setCourseId(event.target.value || null)} required={action === "move"}>
          <option value="">{action === "move" ? "请选择目标课程" : "未归类"}</option>
          {courses.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
        </select></label>
        {courseId && <ChapterPicker key={courseId} name="chapterId" label="目标章节" empty="课程根目录"
          options={courses.find(({ id }) => id === courseId)?.chapters ?? []} />}
      </>}
      {choice.selectItems && <fieldset>
        <legend>选择要删除的候选</legend>
        {items.map(({ id, title, status }) => <label key={id} className="check-field">
          <input type="checkbox" checked={chosen.includes(id)} onChange={(event) =>
            setChosen((prev) => event.target.checked ? [...prev, id] : prev.filter((item) => item !== id))} />
          <span>{title} · {statusLabels[status]}</span>
        </label>)}
        {chosen.length > 100 && <p role="alert">每次最多清理 100 项。</p>}
      </fieldset>}
    </fieldset>
    <ConfirmActions label={choice.label} cancelHref={cancelHref} pending={pending} error={error}
      danger={action !== "move" && action !== "restore" && action !== "rename"}
      disabled={disabled
        || (choice.selectItems && (!chosen.length || chosen.length > 100)) || (action === "move" && !courseId)} />
  </form>;
}

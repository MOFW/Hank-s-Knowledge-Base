"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppLink } from "./app-link";
import { ChapterPicker, type ChapterOption } from "./chapter-picker";
import { useRouteTransition } from "./route-transition";
import { useNavigateAfterSave } from "./save-notice";
import { useSave } from "./use-save";
import { useUnsavedChanges } from "./use-unsaved-changes";

type Item = { id: string; title: string; rowVersion: number };

export function ReadingOrderEditor({ courseId, chapterId, kind, chapters, items, returnTo }: {
  courseId: string; chapterId: string | null; kind: "topic" | "chapter";
  chapters: ChapterOption[]; items: Item[]; returnTo: string;
}) {
  const [order, setOrder] = useState(items);
  const draft = useUnsavedChanges();
  const { navigate } = useRouteTransition();
  const router = useRouter();
  const afterSave = useNavigateAfterSave();
  const { save, pending, disabled, error, conflict } = useSave(`/api/v1/courses/${courseId}/reading-order`, undefined, "PUT");
  const changed = items.some((item, index) => item.id !== order[index].id);
  function href(type: typeof kind, chapter: string | null) {
    return `/courses/${courseId}/organize?kind=${type}${chapter ? `&chapterId=${chapter}` : ""}`;
  }
  function move(from: number, to: number) {
    if (from === to) return;
    const next = order.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    if (items.some((entry, index) => entry.id !== next[index].id)) draft.markDirty();
    else draft.markSaved();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed) return;
    const saved = await save({ kind, chapterId, items: order.map(({ id, rowVersion }) => ({ id, rowVersion })) });
    if (saved) {
      draft.markSaved();
      afterSave(returnTo, "已保存阅读顺序");
    }
  }

  return <section className="reading-order-editor">
    <div className="section-head"><h2>阅读顺序</h2></div>
    <div className="course-home-tabs">
      <nav aria-label="排序对象">
        <AppLink aria-current={kind === "topic" ? "page" : undefined} href={href("topic", chapterId)}>笔记顺序</AppLink>
        <AppLink aria-current={kind === "chapter" ? "page" : undefined} href={href("chapter", chapterId)}>章节顺序</AppLink>
      </nav>
    </div>
    <fieldset className="order-scope" disabled={draft.dirty || pending}>
      <ChapterPicker options={chapters} initial={chapterId} label={kind === "chapter" ? "上级章节" : "所在章节"}
        empty={kind === "chapter" ? "一级章节" : "课程根目录"} onSelect={(chapter) => navigate(href(kind, chapter))} />
    </fieldset>
    <form onSubmit={submit} aria-busy={pending}>
      {order.length ? <ol className="reading-order-list">
        {order.map(({ id, title }, index) => <li key={id}>
          {kind === "chapter" ? <AppLink href={`/manage/chapter/${id}`}>{title}</AppLink> : <span>{title}</span>}
          {order.length > 1 && <div className="reading-order-controls">
            <button type="button" className="reading-rail-icon" aria-label={`上移 ${title}`} disabled={index === 0 || pending}
              onClick={() => move(index, index - 1)}><ArrowUp size={16} aria-hidden="true" /></button>
            <button type="button" className="reading-rail-icon" aria-label={`下移 ${title}`} disabled={index === order.length - 1 || pending}
              onClick={() => move(index, index + 1)}><ArrowDown size={16} aria-hidden="true" /></button>
            <input key={index} type="number" min={1} max={order.length} step={1} defaultValue={index + 1} disabled={pending}
              aria-label={`将 ${title} 移到第几位`} title="输入目标位置后按回车" onBlur={(event) => {
                const input = event.currentTarget;
                if (input.value && input.validity.valid) move(index, input.valueAsNumber - 1);
                else input.value = String(index + 1);
              }} onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.currentTarget.blur();
              }} />
          </div>}
        </li>)}
      </ol> : <p className="empty">{kind === "chapter" ? "这里还没有下级章节。" : "这里还没有直属笔记。"}</p>}
      {order.length > 1 && <div className="actions">
        <button className="button primary" type="submit" disabled={!changed || disabled}>保存阅读顺序</button>
        {changed && <button className="button" type="button" disabled={pending} onClick={() => { setOrder(items); draft.markSaved(); }}>取消调整</button>}
      </div>}
      {error && <p role="alert">{error}</p>}
      {conflict && <button type="button" className="button" onClick={() => { draft.markSaved(); router.refresh(); }}>重新载入此组</button>}
      {draft.confirmation}
    </form>
  </section>;
}

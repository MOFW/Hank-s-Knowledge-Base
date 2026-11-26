"use client";

import { Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import type { TopicQuestionRelation } from "@/db/queries/question-topics";
import type { ReadingHeading } from "./markdown-reading";
import { AppLink } from "./app-link";
import { BrowseDialog } from "./browse-dialog";
import { QuestionTitle } from "./question-title";
import { useNavigateAfterSave } from "./save-notice";
import { useHydrated } from "./use-hydrated";
import { useSave } from "./use-save";
import { useUnsavedChanges } from "./use-unsaved-changes";

type QuestionChoice = { id: string; title: string; courseName: string; rowVersion: number; hasTechniques: boolean };

function QuestionPicker({ linked, onSelect }: { linked: Set<string>; onSelect: (choice: QuestionChoice) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [matched, setMatched] = useState<QuestionChoice[]>([]);
  const [search, setSearch] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function lookup(term: string, cursor?: string) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const params = new URLSearchParams({ kind: "question", q: term, limit: "20", ...(cursor && { cursor }) });
      const response = await fetch(`/api/v1/search?${params}`);
      const { data, error } = await response.json() as {
        data?: { items: QuestionChoice[]; nextCursor: string | null }; error?: { fields?: { message: string }[]; message: string };
      };
      if (!response.ok || !data) throw new Error(error?.fields?.[0]?.message ?? error?.message ?? "题目暂时无法搜索。");
      setMatched(cursor ? [...matched, ...data.items] : data.items);
      setNext(data.nextCursor);
      setSearch(term);
    } catch (error) {
      setError(error instanceof Error ? error.message : "题目暂时无法搜索。");
    } finally {
      setPending(false);
    }
  }

  return <BrowseDialog title="添加关联题目" trigger="添加关联题目">
    {({ close, listRef }) => <>
      <form className="browse-search" role="search" onSubmit={(event) => { event.preventDefault(); void lookup(query.trim()); }}>
        <label htmlFor={id}>搜索题目</label>
        <div className="actions">
          <input id={id} autoFocus type="search" required maxLength={120} value={query} onChange={(event) => setQuery(event.target.value)} />
          <button type="submit" className="button small" disabled={pending}><Search size={16} aria-hidden="true" />搜索</button>
        </div>
      </form>
      <div className="browse-list" ref={listRef} aria-busy={pending}>
        {matched.map((item) => <button key={item.id} type="button" className="browse-row" disabled={linked.has(item.id)}
          data-browse-item={linked.has(item.id) ? undefined : ""} onClick={() => { close(); onSelect(item); }}>
          <span><QuestionTitle text={item.title} /><small>{item.courseName}{linked.has(item.id) && " · 已关联"}</small></span>
        </button>)}
        {search && !matched.length && <p className="empty">没有匹配的题目。</p>}
        {next && <button type="button" className="button small" disabled={pending} onClick={() => void lookup(search, next)}>加载更多结果</button>}
      </div>
      {pending && <p className="field-hint" role="status">正在搜索题目…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>}
  </BrowseDialog>;
}

type Selection = { questionId: string; title: string; rowVersion: number; hasTechniques: boolean; relation?: TopicQuestionRelation };

function RelationFields({ topicId, version, selection, placements, onClose }: {
  topicId: string; version: number; selection: Selection; placements: ReadingHeading[]; onClose: () => void;
}) {
  const { questionId, title, rowVersion, relation } = selection;
  const endpoint = `/api/v1/topics/${topicId}/questions/${questionId}`;
  const path = `/topics/${topicId}/examples`;
  const patch = useSave(endpoint, version);
  const remove = useSave(endpoint, version, "DELETE");
  const draft = useUnsavedChanges();
  const navigateAfterSave = useNavigateAfterSave();
  const [featured, setFeatured] = useState(relation?.displayRole === "featured");
  const [removing, setRemoving] = useState(false);
  const [techniques, setTechniques] = useState(relation?.useQuestionTechniques ?? false);
  const previousAnchor = relation?.placementAnchor ?? "";
  const staleAnchor = previousAnchor && !placements.some(({ id }) => id === previousAnchor);
  const busy = patch.pending || remove.pending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const anchor = String(fields.get("anchor") ?? "");
    const saved = await patch.save({
      expectedQuestionVersion: rowVersion, displayRole: featured ? "featured" : "related",
      ...(featured && {
        displayOrder: Number(fields.get("order")), noteMd: fields.get("note"),
        ...(anchor !== previousAnchor && { placementAnchor: anchor || null }),
        ...(techniques !== Boolean(relation?.useQuestionTechniques) && { useQuestionTechniques: techniques }),
      }),
    });
    if (saved) {
      draft.markSaved();
      navigateAfterSave(path, relation ? "关联设置已保存" : "题目已关联");
    }
  }

  return <form className="relation-fields document-editor" onSubmit={submit} onChange={draft.onFormChange} aria-busy={busy}>
    <h2><QuestionTitle text={title} /></h2>
    <fieldset disabled={patch.disabled || remove.disabled || patch.succeeded || remove.succeeded}>
      <label>阅读中的用途<select value={featured ? "featured" : "related"} onChange={(event) => setFeatured(event.target.value === "featured")}>
        <option value="related">普通关联习题</option>
        <option value="featured">精选例题</option>
      </select></label>
      <div hidden={!featured} className="relation-placement">
        <label>正文位置<select name="anchor" defaultValue={previousAnchor}>
          <option value="">笔记正文末尾</option>
          {staleAnchor && <option value={previousAnchor}>原位置已失效 · 当前显示于正文末尾</option>}
          {placements.map(({ id, label, level }) => <option key={id} value={id}>
            {level ? "小节末尾" : "段落之后"} · {label}
          </option>)}
        </select></label>
        <label>同位置顺序<input type="number" name="order" min={0} max={2147483647} step={1} required defaultValue={relation?.displayOrder ?? 0} /></label>
        <label className="check-field"><input type="checkbox" checked={techniques} disabled={!techniques && !selection.hasTechniques}
          onChange={(event) => setTechniques(event.target.checked)} />使用原题的「思路与关键技巧」作为简析</label>
        <label>{techniques ? "知识应用说明（Markdown）" : "已核实的简析（Markdown）"}
          <textarea name="note" rows={4} maxLength={131072} defaultValue={relation?.noteMd} />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="button primary">{relation ? "保存关联设置" : "添加关联"}</button>
        <button type="button" className="button" onClick={onClose}>取消</button>
        {relation && !removing && <button type="button" className="text-link danger" onClick={() => setRemoving(true)}>解除关联</button>}
      </div>
      {removing && <div className="actions">
        <span>解除此题与当前笔记的关联？</span>
        <button type="button" className="button danger" onClick={async () => {
          if (await remove.save({ expectedQuestionVersion: rowVersion })) {
            draft.markSaved();
            navigateAfterSave(path, "已解除关联");
          }
        }}>确认解除</button>
        <button type="button" className="text-link" onClick={() => setRemoving(false)}>保留关联</button>
      </div>}
    </fieldset>
    {(patch.error || remove.error) && <p className="error" role="alert">{patch.error || remove.error}</p>}
    {draft.confirmation}
  </form>;
}

export function TopicQuestionEditor({ topicId, version, relations, placements }: {
  topicId: string; version: number; relations: TopicQuestionRelation[]; placements: ReadingHeading[];
}) {
  const [selected, setSelected] = useState<Selection>();
  const ready = useHydrated();
  return <>
    {selected ? <RelationFields key={selected.questionId} topicId={topicId} version={version}
      selection={selected} placements={placements} onClose={() => setSelected(undefined)} />
      : <QuestionPicker linked={new Set(relations.map(({ questionId }) => questionId))}
        onSelect={({ id, ...item }) => setSelected({ ...item, questionId: id })} />}
    {relations.length > 0 ? <ul className="topic-question-relations">
      {relations.map((relation) => <li key={relation.questionId}>
        <AppLink className="text-link" href={`/questions/${relation.questionId}`}><QuestionTitle text={relation.title} /></AppLink>
        <span className="field-hint">{relation.displayRole === "featured" ? `精选 · 顺序 ${relation.displayOrder}` : "普通关联"}</span>
        <button type="button" className="button small" disabled={!ready || Boolean(selected)} aria-label={`设置关联 · ${relation.title}`}
          onClick={() => setSelected({ ...relation, relation })}>设置</button>
      </li>)}
    </ul> : <p className="empty">这篇笔记还没有关联题目。</p>}
  </>;
}

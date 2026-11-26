"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useSave } from "./use-save";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { EditorActions, EditorFeedback, MarkdownEditor, MarkdownHelp } from "./markdown-editor";
import { useNavigateAfterSave } from "./save-notice";
import { ChapterPicker, type ChapterOption } from "./chapter-picker";

export function CreateCatalogForm({ courseId, chapters = [], returnTo }: { courseId?: string; chapters?: ChapterOption[]; returnTo?: string }) {
  const navigateAfterSave = useNavigateAfterSave();
  const label = courseId ? "新增章节" : "新增课程";
  const { pending, disabled, error, succeeded, save } = useSave(courseId ? "/api/v1/chapters" : "/api/v1/courses");
  const draft = useUnsavedChanges();
  const [formVersion, setFormVersion] = useState(0);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title"));
    const descriptionMd = String(data.get("description"));
    const saved = await save(courseId
      ? { title, descriptionMd, courseId, parentId: data.get("parentId") || null }
      : { name: title, descriptionMd });
    if (saved) {
      draft.markSaved();
      if (courseId) setFormVersion((version) => version + 1);
      navigateAfterSave(returnTo ?? `/courses/${courseId ?? saved.id}`);
    }
  }
  return <details className="create-panel">
    <summary><Plus size={17} aria-hidden="true" />{label}</summary>
    <form method="post" onSubmit={onSubmit} onChange={draft.onFormChange} aria-busy={pending}>
      <fieldset key={formVersion} disabled={disabled}>
        <label>名称<input name="title" required maxLength={120} /></label>
        {courseId && <ChapterPicker label="上级章节" name="parentId" options={chapters} empty="无（根章节）" onSelect={draft.markDirty} />}
        <label>简介<textarea name="description" rows={3} maxLength={5_000} /></label>
        <button className="button primary" type="submit">{pending ? "正在保存…" : label}</button>
      </fieldset>
      <EditorFeedback pending={pending} error={error} succeeded={succeeded} dirty={draft.dirty} />
      {draft.confirmation}
    </form>
  </details>;
}

type ExistingTopic = {
  id: string; title: string; summaryMd: string; bodyMd: string; supplementMd: string | null;
  chapterId: string | null; rowVersion: number;
};

export type TopicCourse = { id: string; name: string; chapters: ChapterOption[] };

export function TopicEditor({ courseId, chapters, topic, defaultChapter, courses, relations }: {
  courseId: string | null; chapters: ChapterOption[]; topic?: ExistingTopic; defaultChapter?: string; courses?: TopicCourse[];
  relations?: { options: { id: string; title: string; courseName: string }[]; selected: string[] };
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const [bodyMd, setBody] = useState(topic?.bodyMd ?? "");
  const [supplementMd, setSupplement] = useState(topic?.supplementMd ?? "");
  const [selectedCourseId, setCourseId] = useState(courseId);
  const [selectedChapterId, setChapterId] = useState(topic?.chapterId ?? defaultChapter ?? "");
  const [relatedIds, setRelatedIds] = useState(relations?.selected ?? []);
  const [relationQuery, setRelationQuery] = useState("");
  const availableChapters = courses ? courses.find(({ id }) => id === selectedCourseId)?.chapters ?? [] : chapters;
  const url = topic ? `/api/v1/topics/${topic.id}` : "/api/v1/topics";
  const { pending, disabled, error, conflict, succeeded, save } = useSave(url, topic?.rowVersion);
  const draft = useUnsavedChanges();
  const cancelTo = topic ? `/topics/${topic.id}` : courseId ? `/courses/${courseId}` : "/topics/unassigned";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = { title: form.get("title"), chapterId: form.get("chapterId") || null, summaryMd: form.get("summaryMd"), bodyMd };
    const changedRelations = relations && (relatedIds.length !== relations.selected.length
      || relatedIds.some((id) => !relations.selected.includes(id)));
    const saved = await save({ ...fields, courseId: selectedCourseId,
      ...(supplementMd !== (topic?.supplementMd ?? "") && { supplementMd: supplementMd.trim() ? supplementMd : null }),
      ...(changedRelations && { relatedTopicIds: relatedIds }) });
    if (saved) {
      draft.markSaved();
      navigateAfterSave(`/topics/${saved.id}`);
    }
  }
  return <form className="topic-editor document-editor" method="post" onSubmit={onSubmit} onChange={draft.onFormChange} aria-busy={pending}>
    <fieldset disabled={disabled}>
      <div className="editor-fields">
        <label>标题<input name="title" required maxLength={120} defaultValue={topic?.title} /></label>
        {courses && <label>课程<select value={selectedCourseId ?? ""} onChange={(event) => {
          setCourseId(event.target.value || null);
          setChapterId("");
        }}>
          <option value="">未归类</option>
          {courses.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select></label>}
        {selectedCourseId && <ChapterPicker key={selectedCourseId} name="chapterId" options={availableChapters}
          initial={selectedChapterId} empty="课程根目录" onSelect={(value) => { setChapterId(value); draft.markDirty(); }} />}
      </div>
      {relations && relations.options.length > 0 && <details className="editor-section">
        <summary>关联知识点（{relatedIds.length}）</summary>
        <div className="editor-section-body">
          <label>查找知识点<input value={relationQuery} onChange={(event) => setRelationQuery(event.target.value)} /></label>
          {relations.options.filter(({ id, title, courseName }) => relatedIds.includes(id)
            || (title + " " + courseName).toLowerCase().includes(relationQuery.trim().toLowerCase()))
            .map(({ id, title, courseName }) => <label key={id} className="check-field">
              <input type="checkbox" checked={relatedIds.includes(id)} onChange={(event) => {
                setRelatedIds((current) => event.target.checked ? [...current, id] : current.filter((value) => value !== id));
                draft.markDirty();
              }} />
              {title} · {courseName}
            </label>)}
        </div>
      </details>}
      <label>摘要<textarea name="summaryMd" rows={2} maxLength={2700} defaultValue={topic?.summaryMd} /></label>
      <MarkdownEditor name="bodyMd" label="正文" value={bodyMd} rows={16}
        onChange={(value) => { setBody(value); draft.markDirty(); }} />
      <MarkdownHelp />
      <details className="editor-section">
        <summary>学习补充（可选）</summary>
        <div className="editor-section-body">
          <MarkdownEditor name="supplementMd" label="补充内容" value={supplementMd} rows={5}
            onChange={(value) => { setSupplement(value); draft.markDirty(); }} />
        </div>
      </details>
    </fieldset>
    <EditorActions label="保存知识点" cancelHref={cancelTo} disabled={disabled} pending={pending} error={error} conflict={conflict}
      succeeded={succeeded} dirty={draft.dirty} savedHref={cancelTo} />
    {draft.confirmation}
  </form>;
}

export function RenameCourse({ id, name, rowVersion, returnTo }: { id: string; name: string; rowVersion: number; returnTo?: string }) {
  const navigateAfterSave = useNavigateAfterSave();
  const { save, pending, disabled, error } = useSave(`/api/v1/courses/${id}`, rowVersion);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (await save({ name: fields.get("name") })) navigateAfterSave(returnTo ?? `/courses/${id}`);
  }
  return <details className="create-panel">
    <summary>重命名课程</summary>
    <form method="post" onSubmit={submit} className="panel-content" aria-busy={pending}>
      <label>课程名称<input name="name" defaultValue={name} required maxLength={120} disabled={disabled} /></label>
      <button className="button" type="submit" disabled={disabled}>保存名称</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}

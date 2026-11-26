"use client";

import { ImagePlus, X } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { solutionDocument, solutionSteps, type SolutionDocument, type SolutionStep } from "@/domain/solution";
import { solutionLayerAnchorIssues, solutionLayers, type SolutionLayers } from "@/domain/solution-layers";
import { solutionAnchorReviewIssues } from "@/lib/solution-anchors";
import { useSave } from "./use-save";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { EditorActions, MarkdownEditor, MarkdownHelp } from "./markdown-editor";
import { useNavigateAfterSave } from "./save-notice";
import { SolutionReader } from "./solution-reader";

const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const imageLimit = 8 * 1024 * 1024;
const maxImages = 8;
const anchorIssueLabels = { missing: "找不到标记", duplicate: "正文中有重复标记", unplaced: "标记未紧邻目标" };

type CourseChoice = { id: string; name: string };
type TopicChoice = { id: string; title: string; courseId: string | null; chapterTitle: string | null };
type QuestionFields = {
  id: string;
  rowVersion: number;
  primaryCourseId: string | null;
  title: string;
  statementMd: string;
  difficulty: number | null;
  sourceDate: string | null;
  sourceTitle: string | null;
  sourceLocator: string | null;
  finalAnswerMd: string;
  solutionDocument: SolutionDocument | null;
  solutionLayers: SolutionLayers | null;
  solutionSteps: SolutionStep[];
  keyTechniquesMd: string;
  topicIds: string[];
  originalAssetIds: string[];
};

const stepTemplate = JSON.stringify([{ id: "first-step", title: "", bodyMd: "" }], null, 2);
const layersTemplate = JSON.stringify({
  mainThreads: [{ anchorId: "reason", turns: [{
    id: "first-question", learner: { markdown: "这里使用了什么条件？", origin: "owner", speaker: "owner" },
    replies: [{ markdown: "补充说明。", origin: "owner", speaker: "owner" }],
  }] }],
  alternatives: [],
  supplements: [],
}, null, 2);

function readSteps(raw: string) {
  let value: unknown;
  try {
    value = raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return { error: "分步解答须为有效的 JSON 数组。请检查引号、逗号及公式中的反斜杠。" } as const;
  }
  const parsed = solutionSteps.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.length ? `（${issue.path.join(".")}）` : "";
    return { error: `${issue.message}${path}` } as const;
  }
  return { steps: parsed.data } as const;
}

function OriginalImages({ initial, onChange, onBusy }: {
  initial: string[];
  onChange: (ids: string[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [images, setImages] = useState(initial.map((id, index) => ({ id, name: `原题图片 ${index + 1}` })));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const uploadAttempt = useRef<{ file: File; key: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();

  function update(next: typeof images) {
    setImages(next);
    onChange(next.map(({ id }) => id));
  }

  async function upload(file: File) {
    if (!imageTypes.includes(file.type) || file.size === 0 || file.size > imageLimit) {
      uploadAttempt.current = null;
      setError("请选择一张大小不超过 8 MiB 的 PNG、JPEG、GIF 或 WebP 图片。");
      if (input.current) input.current.value = "";
      return;
    }
    if (inFlight.current || images.length >= maxImages) return;
    inFlight.current = true;
    if (uploadAttempt.current?.file !== file) uploadAttempt.current = { file, key: crypto.randomUUID() };
    setPending(true);
    onBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/assets", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
          "Idempotency-Key": uploadAttempt.current.key,
        },
        body: file,
      });
      const payload = await response.json() as { data?: { id: string; originalFilename: string }; error?: { message?: string } };
      if (!response.ok || !payload.data) {
        if (!response.ok && response.status < 500) {
          uploadAttempt.current = null;
          if (input.current) input.current.value = "";
        }
        setError(payload.error?.message ?? "无法上传图片。");
        return;
      }
      const image = { id: payload.data.id, name: payload.data.originalFilename };
      if (!images.some(({ id }) => id === image.id)) update([...images, image]);
      uploadAttempt.current = null;
      if (input.current) input.current.value = "";
    } catch {
      setError("未收到上传结果。可重试同一张图片。");
    } finally {
      inFlight.current = false;
      setPending(false);
      onBusy(false);
    }
  }

  return <div className="image-editor">
    <label>
      <span><ImagePlus size={16} aria-hidden="true" /> 原题图片</span>
      <input ref={input} type="file" accept={imageTypes.join(",")} disabled={pending || images.length >= maxImages} data-ui-only aria-describedby={hintId}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }} />
    </label>
    <p className="field-hint" id={hintId}>PNG、JPEG、GIF 或 WebP，每张不超过 8 MiB。保存题目时关联图片。</p>
    {images.length >= maxImages && <p className="field-hint">最多可关联 {maxImages} 张原题图片。</p>}
    {pending && <p className="field-hint" role="status">正在上传图片…</p>}
    {!pending && images.length > 0 && <p className="field-hint" role="status">已添加 {images.length} / {maxImages} 张图片</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {error && <button type="button" className="button small" disabled={pending} onClick={() => {
      if (uploadAttempt.current) void upload(uploadAttempt.current.file);
      else input.current?.click();
    }}>重新上传</button>}
    {images.length > 0 && <ul className="image-list">
      {images.map((image) => <li key={image.id}>
        {/* Use the original authenticated response to retain the user's session. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/v1/assets/${image.id}`} alt={image.name} />
        <small>{image.name}</small>
        <button className="button small" type="button" disabled={pending} aria-label={`移除 ${image.name}`}
          onClick={() => update(images.filter(({ id }) => id !== image.id))}>移除</button>
      </li>)}
    </ul>}
  </div>;
}

export function QuestionEditor({ courses, topics, question, defaultCourseId, defaultTopicId }: {
  courses: CourseChoice[];
  topics: TopicChoice[];
  question?: QuestionFields;
  defaultCourseId?: string | null;
  defaultTopicId?: string;
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const [statementMd, setStatement] = useState(question?.statementMd ?? "");
  const [finalAnswerMd, setFinalAnswer] = useState(question?.finalAnswerMd ?? "");
  const [keyTechniquesMd, setKeyTechniques] = useState(question?.keyTechniquesMd ?? "");
  const [bodyMd, setBodyMd] = useState(question?.solutionDocument?.bodyMd ?? "");
  const [annotationJson, setAnnotationJson] = useState(() => question?.solutionDocument?.annotations.length
    ? JSON.stringify(question.solutionDocument.annotations.map((note) => Object.fromEntries(
      Object.entries(note).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value)),
    )), null, 2) : "");
  const [stepAnchorIds, setStepAnchorIds] = useState(question?.solutionDocument?.stepAnchorIds?.join(", ") ?? "");
  const [documentError, setDocumentError] = useState("");
  const [documentPreview, setDocumentPreview] = useState<{ document: SolutionDocument | null; layers: SolutionLayers | null; steps: SolutionStep[] } | null>(null);
  const [layersJson, setLayersJson] = useState(() => question?.solutionLayers ? JSON.stringify(question.solutionLayers, null, 2) : "");
  const layersInput = useRef<HTMLTextAreaElement>(null);
  const [anchorIssues, setAnchorIssues] = useState(() =>
    question?.solutionDocument ? solutionAnchorReviewIssues(question.solutionDocument) : [],
  );
  const documentEditor = useRef<HTMLDetailsElement>(null);
  const documentInput = useRef<HTMLTextAreaElement>(null);
  const [stepJson, setStepJson] = useState(() => question?.solutionSteps.length ? JSON.stringify(
    question.solutionSteps.map((step) => Object.fromEntries(Object.entries(step).filter(([, value]) => value.length))),
    null, 2,
  ) : "");
  const [stepError, setStepError] = useState("");
  const [stepPreview, setStepPreview] = useState<SolutionStep[] | null>(null);
  const stepEditor = useRef<HTMLDetailsElement>(null);
  const stepInput = useRef<HTMLTextAreaElement>(null);
  const stepHelp = useId();
  const [assetIds, setAssetIds] = useState(question?.originalAssetIds ?? []);
  const [uploading, setUploading] = useState(false);
  const { pending, disabled, error, conflict, succeeded, save } = useSave(question ? `/api/v1/questions/${question.id}` : "/api/v1/questions", question?.rowVersion);
  const draft = useUnsavedChanges();
  const omittedTopic = (id: string) => Boolean(question?.topicIds.includes(id) && !selectedTopics.has(id));
  const [selectedTopics, setSelectedTopics] = useState(() => new Set(question?.topicIds ?? (defaultTopicId ? [defaultTopicId] : [])));
  const [topicQuery, setTopicQuery] = useState("");
  const topicResults = useRef<HTMLDivElement>(null);
  const query = topicQuery.trim().toLocaleLowerCase();
  const topicGroups = new Map<string | null, TopicChoice[]>();
  for (const topic of topics) {
    const group = topicGroups.get(topic.courseId) ?? [];
    group.push(topic);
    topicGroups.set(topic.courseId, group);
  }

  function matchesTopic(topic: TopicChoice, courseName: string) {
    return !query || `${topic.title} ${topic.chapterTitle ?? ""} ${courseName}`.toLocaleLowerCase().includes(query);
  }

  function filterTopics(value: string) {
    setTopicQuery(value);
    if (value.trim()) topicResults.current?.querySelectorAll("details").forEach((group) => { group.open = true; });
  }

  function toggleTopic(id: string) {
    setSelectedTopics((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setStepPreview(null);
    setStepError("");
    setDocumentPreview(null);
    setDocumentError("");
    draft.markDirty();
  }

  function changeSteps(value: string) {
    setStepJson(value);
    setStepError("");
    setStepPreview(null);
    draft.markDirty();
  }

  function validateSteps() {
    const result = readSteps(stepJson);
    const steps = result.steps?.map((step) => ({ ...step, topicIds: step.topicIds.filter((id) => !omittedTopic(id)) }));
    const unlinked = steps?.find((step) => step.topicIds.some((id) => !selectedTopics.has(id)));
    const message = result.error ?? (unlinked ? `「${unlinked.title}」引用了尚未关联到题目的知识点。` : "");
    setStepError(message);
    if (message) {
      setStepPreview(null);
      if (stepEditor.current) stepEditor.current.open = true;
      stepInput.current?.focus();
      return null;
    }
    return steps ?? null;
  }

  function changeDocument(update: (value: string) => void, value: string) {
    update(value);
    setDocumentError("");
    setDocumentPreview(null);
    setAnchorIssues([]);
    draft.markDirty();
  }

  function validateDocument() {
    function fail(message: string) {
      setDocumentError(message);
      setDocumentPreview(null);
      if (documentEditor.current) documentEditor.current.open = true;
      documentInput.current?.focus();
      return undefined;
    }

    if (!(bodyMd.trim() || annotationJson.trim() || stepAnchorIds.trim())) return null;
    let annotations: unknown;
    try {
      annotations = annotationJson.trim() ? JSON.parse(annotationJson) : [];
    } catch {
      return fail("深入解释须为有效的 JSON 数组。请检查引号、逗号及公式中的反斜杠。");
    }
    const ids = stepAnchorIds.split(/[,，]/).map((id) => id.trim()).filter(Boolean);
    const parsed = solutionDocument.safeParse({ bodyMd, annotations, ...(ids.length ? { stepAnchorIds: ids } : {}) });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue.path.length ? `（${issue.path.join(".")}）` : "";
      return fail(`${issue.message}${path}`);
    }
    const annotationsWithLiveTopics = parsed.data.annotations.map((note) => ({
      ...note, topicIds: note.topicIds.filter((id) => !omittedTopic(id)),
    }));
    const unlinked = annotationsWithLiveTopics.find((note) => note.topicIds.some((id) => !selectedTopics.has(id)));
    if (unlinked) return fail(`「${unlinked.label ?? unlinked.id}」引用了尚未关联到题目的知识点。`);
    setDocumentError("");
    return { ...parsed.data, annotations: annotationsWithLiveTopics };
  }

  function validateLayers(document: SolutionDocument | null) {
    if (!layersJson.trim()) return null;
    function fail(message: string) {
      setDocumentError(message);
      setDocumentPreview(null);
      if (documentEditor.current) documentEditor.current.open = true;
      layersInput.current?.focus();
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(layersJson);
    } catch {
      return fail("追问与解法须为有效的 JSON。请检查引号、逗号及公式中的反斜杠。");
    }
    const parsed = solutionLayers.nullable().safeParse(value);
    if (!parsed.success) {
      const { path, message } = parsed.error.issues[0];
      return fail(`${message}（${["solutionLayers", ...path].join(".")}）`);
    }
    const issue = solutionLayerAnchorIssues(document, parsed.data)[0];
    return issue ? fail(`${issue.message}（${issue.path.join(".")}）`) : parsed.data;
  }

  function previewDocument() {
    const document = validateDocument();
    if (document === undefined) return;
    const layers = validateLayers(document);
    const steps = validateSteps();
    if (layers === undefined || !steps) return;
    setDocumentPreview({ document, layers, steps });
    setAnchorIssues(document ? solutionAnchorReviewIssues(document) : []);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const steps = validateSteps();
    if (!steps) return;
    const document = validateDocument();
    if (document === undefined) return;
    const layers = validateLayers(document);
    if (layers === undefined) return;
    const form = new FormData(event.currentTarget);
    const difficulty = form.get("difficulty");
    const saved = await save({
      primaryCourseId: form.get("primaryCourseId") || null,
      title: form.get("title"),
      statementMd,
      difficulty: difficulty ? Number(difficulty) : null,
      topicIds: [...selectedTopics],
      finalAnswerMd,
      solutionDocument: document,
      solutionLayers: layers,
      solutionSteps: steps,
      keyTechniquesMd,
      sourceTitle: form.get("sourceTitle"),
      sourceLocator: form.get("sourceLocator"),
      sourceDate: form.get("sourceDate") || null,
      originalAssetIds: assetIds,
    });
    if (saved) {
      draft.markSaved();
      navigateAfterSave(`/questions/${saved.id}`);
    }
  }

  return <form className="topic-editor document-editor" method="post" onSubmit={onSubmit} onChange={draft.onFormChange} aria-busy={pending || uploading}>
    <fieldset disabled={disabled}>
      <label>标题<input name="title" required maxLength={200} defaultValue={question?.title} /></label>
      <div className="editor-fields">
        <label>主课程<select name="primaryCourseId" defaultValue={question ? question.primaryCourseId ?? "" : defaultCourseId === null ? ""
          : defaultCourseId ?? (courses.length === 1 ? courses[0].id : "")}>
          <option value="">未归类</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select></label>
        <label>难度<select name="difficulty" defaultValue={question?.difficulty ?? ""}>
          <option value="">未评估</option>
          {["1 · 基础", "2 · 入门应用", "3 · 综合应用", "4 · 进阶", "5 · 挑战"].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
        </select></label>
      </div>
      <MarkdownEditor label="题干" name="statementMd" rows={9} value={statementMd} placeholder="输入题目正文，或在下方添加原题图片…"
        onChange={(value) => { setStatement(value); draft.markDirty(); }} />
      <OriginalImages initial={question?.originalAssetIds ?? []} onChange={(ids) => { setAssetIds(ids); draft.markDirty(); }} onBusy={setUploading} />
      <fieldset className="topic-choices">
        <legend>关联知识点</legend>
        <div className="topic-selection-summary">
          <span>已选 {selectedTopics.size} 项</span>
          {topics.filter((topic) => selectedTopics.has(topic.id)).map((topic) => <button type="button" className="selected-topic" key={topic.id}
            onClick={() => toggleTopic(topic.id)} aria-label={`取消关联 ${topic.title}`}>{topic.title}<X size={14} aria-hidden="true" /></button>)}
        </div>
        {topics.length > 0 && <label>查找知识点<input type="search" data-ui-only value={topicQuery}
          onChange={(event) => filterTopics(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
          placeholder="输入知识点、章节或课程名称" /></label>}
        {topicGroups.size === 0 && <p className="empty">暂无可关联的知识点。</p>}
        {query && !topics.some((topic) => matchesTopic(topic, courses.find((course) => course.id === topic.courseId)?.name ?? "未归类")) && <p className="empty" role="status">没有匹配的知识点。试试更短的关键词。</p>}
        <div className="topic-selection-results" ref={topicResults}>
        {[...courses, { id: null, name: "未归类" }].map((course) => {
          const group = topicGroups.get(course.id);
          if (!group?.length) return null;
          const visible = group.filter((topic) => matchesTopic(topic, course.name));
          return <details key={course.id ?? "unassigned"} className="choice-group" suppressHydrationWarning
            hidden={visible.length === 0} open={query ? true : group.some((topic) => selectedTopics.has(topic.id)) || undefined}>
            <summary>{course.name}<small>{visible.length} 个知识点</small></summary>
            {group.map((topic) => <label className="check-field" key={topic.id} hidden={!matchesTopic(topic, course.name)}>
              <input type="checkbox" name="topicIds" value={topic.id} checked={selectedTopics.has(topic.id)} onChange={() => toggleTopic(topic.id)} />
              <span>{topic.title} {topic.chapterTitle && <small>{topic.chapterTitle}</small>}</span>
            </label>)}
          </details>;
        })}
        </div>
      </fieldset>
      <details ref={documentEditor} className="editor-section" suppressHydrationWarning>
        <summary>连续解答与注释 <small>高级编辑</small></summary>
        <div className="editor-section-body">
          <MarkdownEditor label="解答正文" name="solutionBodyMd" rows={8} value={bodyMd} onChange={(value) => changeDocument(setBodyMd, value)} />
          <p className="field-hint">将 <code>[^hkb-anchor-id]</code> 紧接在要解释的文字或行内公式之后。独立公式的锚点放在紧接公式的下一段。移动原文时一起移动锚点，修订时保留原 ID。</p>
          <label>深入解释 JSON<textarea ref={documentInput} className="step-json" rows={5} spellCheck={false}
            value={annotationJson} aria-invalid={Boolean(documentError)}
            placeholder={JSON.stringify([{ id: "anchor-id", label: "此处的推导", explanationMd: "" }], null, 2)}
            onChange={(event) => changeDocument(setAnnotationJson, event.target.value)} /></label>
          <p className="field-hint">每条解释需要 id。可填写 label、basisMd、strategyMd、explanationMd、aiExplanationMd、commonMistakesMd 和 topicIds（已关联知识点 UUID）。</p>
          <label>逐步阅读的段落末尾锚点<input value={stepAnchorIds} onChange={(event) => changeDocument(setStepAnchorIds, event.target.value)}
            placeholder="可选，多个 ID 用逗号分隔" /></label>
          <label>追问、替代解法与整题补充 JSON
            <textarea ref={layersInput} rows={10} className="step-json" spellCheck={false} value={layersJson}
              onChange={(event) => changeDocument(setLayersJson, event.target.value)} />
          </label>
          <p className="field-hint">主解的追问引用正文中的 <code>[^hkb-ID]</code>，每个替代解法在自己的正文中定义锚点。保留各轮标识、发言者和来源引句。清空可移除此栏保存的内容。</p>
          <div className="actions">
            {!layersJson.trim() && <button type="button" className="button" onClick={() => changeDocument(setLayersJson, layersTemplate)}>插入追问模板</button>}
            <button type="button" className="button" onClick={previewDocument}>校验并预览解答</button>
          </div>
          {documentError && <p className="error" role="alert">{documentError}</p>}
          {anchorIssues.length > 0 && <div className="field-hint" role="status">
            <p>注释锚点待审核。正文仍可阅读。</p>
            <ul>{anchorIssues.map(({ id, kind, reason }) => <li key={`${kind}-${id}`}>
              {kind === "step" ? "逐步阅读" : "深入解释"} <code>{id}</code> · {anchorIssueLabels[reason]}
            </li>)}</ul>
          </div>}
          {documentPreview && <SolutionReader scope="document-preview" document={documentPreview.document}
            layers={documentPreview.layers} steps={documentPreview.steps} answerMd={finalAnswerMd} techniquesMd={keyTechniquesMd} topics={topics} />}
        </div>
      </details>
      <details className="editor-section" suppressHydrationWarning>
        <summary>旧版解答与关键技巧 <small>可选</small></summary>
        <div className="editor-section-body">
          <MarkdownEditor label="完整解答" name="finalAnswerMd" rows={8} value={finalAnswerMd} onChange={(value) => { setFinalAnswer(value); draft.markDirty(); }} />
          <MarkdownEditor label="关键技巧" name="keyTechniquesMd" rows={4} value={keyTechniquesMd} onChange={(value) => { setKeyTechniques(value); draft.markDirty(); }} />
        </div>
      </details>
      <details ref={stepEditor} className="editor-section" suppressHydrationWarning>
        <summary>旧版分步解答 <small>{question?.solutionSteps.length ? `已保存 ${question.solutionSteps.length} 步` : "可选"}</small></summary>
        <div className="editor-section-body">
          <p id={stepHelp} className="field-hint">粘贴步骤 JSON 数组。数组顺序就是阅读顺序，修订时保留原来的 id。只需填写 id、title 和 bodyMd。</p>
          <label>步骤 JSON<textarea ref={stepInput} className="step-json" rows={8} value={stepJson} spellCheck={false}
            aria-describedby={stepHelp} aria-invalid={Boolean(stepError)} placeholder={stepTemplate}
            onChange={(event) => changeSteps(event.target.value)} /></label>
          <p className="field-hint">可选字段为 basisMd（依据）、strategyMd（思路）、explanationMd（解释）、aiExplanationMd（AI 补充）、commonMistakesMd（常见错误）和 topicIds（已关联知识点 UUID）。</p>
          {topics.some(({ id }) => selectedTopics.has(id)) && <details>
            <summary>已选知识点的 UUID</summary>
            <ul className="step-topic-ids">{topics.filter(({ id }) => selectedTopics.has(id)).map(({ id, title }) =>
              <li key={id}>{title} <code>{id}</code></li>)}</ul>
          </details>}
          <div className="actions">
            {!stepJson.trim() && <button type="button" className="button" onClick={() => changeSteps(stepTemplate)}>插入模板</button>}
            <button type="button" className="button" onClick={() => setStepPreview(validateSteps())}>校验并预览步骤</button>
          </div>
          {stepError && <p className="error" role="alert">{stepError}</p>}
          {stepPreview && (stepPreview.length
            ? <SolutionReader scope="steps-preview" steps={stepPreview} answerMd="" topics={topics} review />
            : <p className="field-hint" role="status">没有解题步骤。</p>)}
        </div>
      </details>
      <details className="editor-section" open={!!(question?.sourceTitle || question?.sourceLocator || question?.sourceDate)}>
        <summary>题目来源 <small>可选</small></summary>
        <div className="editor-section-body">
          <div className="editor-fields">
            <label>来源标题<input name="sourceTitle" maxLength={200} defaultValue={question?.sourceTitle ?? ""} /></label>
            <label>来源位置<input name="sourceLocator" maxLength={300} placeholder="页码、题号等" defaultValue={question?.sourceLocator ?? ""} /></label>
          </div>
          <label>来源日期<input type="date" name="sourceDate" defaultValue={question?.sourceDate ?? ""} /></label>
        </div>
      </details>
      <MarkdownHelp />
    </fieldset>
    <EditorActions label="保存题目" cancelHref={question ? `/questions/${question.id}` : "/questions"} disabled={disabled || uploading}
      pending={pending} error={error} conflict={conflict} succeeded={succeeded} dirty={draft.dirty} savedHref={question ? `/questions/${question.id}` : undefined} />
    {draft.confirmation}
  </form>;
}

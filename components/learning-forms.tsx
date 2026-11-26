"use client";

import { Trash2, Undo2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { assessmentLabels, reviewAssessment, type ReviewAssessment, type ReviewIntervals } from "@/domain/review";
import { correctionAuthorLabels, masteryLabels, outcomeLabels } from "@/lib/learning-display";
import { useSave } from "./use-save";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { EditorActions, EditorFeedback, MarkdownEditor, MarkdownHelp } from "./markdown-editor";
import { learningStateChanged, type LearningBadgeState } from "./learning-badges";
import { useNavigateAfterSave } from "./save-notice";

type AttemptFields = {
  id: string;
  rowVersion: number;
  attemptedAt: string | null;
  originalWorkMd: string | null;
  errorAnalysisMd: string | null;
  correctionMd: string | null;
  insightMd: string | null;
  outcome: keyof typeof outcomeLabels;
  correctionAuthorKind: keyof typeof correctionAuthorLabels;
};

const shanghaiOffsetMs = 8 * 60 * 60 * 1000;

export function AttemptEditor({ questionId, attempt }: { questionId: string; attempt?: AttemptFields }) {
  const navigateAfterSave = useNavigateAfterSave();
  const questionPath = `/questions/${questionId}`;
  const { pending, disabled, error, conflict, succeeded, save } = useSave(attempt ? `/api/v1/attempts/${attempt.id}` : `/api/v1${questionPath}/attempts`, attempt?.rowVersion);
  const draft = useUnsavedChanges();
  const [notes, setNotes] = useState({
    originalWorkMd: attempt?.originalWorkMd ?? "", errorAnalysisMd: attempt?.errorAnalysisMd ?? "",
    correctionMd: attempt?.correctionMd ?? "", insightMd: attempt?.insightMd ?? "",
  });
  function updateNote(name: keyof typeof notes, value: string) {
    setNotes((previous) => ({ ...previous, [name]: value }));
    draft.markDirty();
  }
  const initialTime = attempt?.attemptedAt ? new Date(Date.parse(attempt.attemptedAt) + shanghaiOffsetMs).toISOString().slice(0, 19) : "";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localTime = String(form.get("attemptedAt"));
    const originalWork = notes.originalWorkMd;
    const saved = await save({
      attemptedAt: localTime ? (localTime === initialTime && attempt?.attemptedAt
        ? attempt.attemptedAt : new Date(localTime + "+08:00").toISOString()) : null,
      originalWorkMd: originalWork || (attempt?.originalWorkMd === "" ? "" : null),
      errorAnalysisMd: notes.errorAnalysisMd || null,
      correctionMd: notes.correctionMd || null,
      insightMd: notes.insightMd || null,
      outcome: form.get("outcome"),
      correctionAuthorKind: form.get("correctionAuthorKind"),
    });
    if (saved) {
      draft.markSaved();
      navigateAfterSave(`${questionPath}#attempt-${saved.id}`);
    }
  }

  return <form className="topic-editor document-editor" method="post" onSubmit={onSubmit} onChange={draft.onFormChange} aria-busy={pending}>
    <fieldset disabled={disabled}>
      {!attempt && <p className="field-hint">可以先用纸笔作答，做完后只记录结果，或补充解题过程。</p>}
      <div className="editor-fields">
        <label>作答时间（UTC+8）<input type="datetime-local" name="attemptedAt" step={1} defaultValue={initialTime} /></label>
        <label>结果<select name="outcome" defaultValue={attempt?.outcome ?? "unknown"}>
          {Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
      <details className="editor-section" open={!!(attempt?.originalWorkMd || attempt?.errorAnalysisMd)} suppressHydrationWarning>
        <summary>填写解题过程 <small>可选</small></summary>
        <div className="editor-section-body">
          <MarkdownEditor label="原始思路" name="originalWorkMd" rows={7} value={notes.originalWorkMd} onChange={(value) => updateNote("originalWorkMd", value)} />
          <MarkdownEditor label="错误分析" name="errorAnalysisMd" rows={4} value={notes.errorAnalysisMd} onChange={(value) => updateNote("errorAnalysisMd", value)} />
          <MarkdownHelp />
        </div>
      </details>
      <details className="editor-section" open={!!(attempt?.correctionMd || attempt?.insightMd)}>
        <summary>订正与本次启发 <small>可稍后补充</small></summary>
        <div className="editor-section-body">
          <MarkdownEditor label="订正过程" name="correctionMd" rows={5} value={notes.correctionMd} onChange={(value) => updateNote("correctionMd", value)} />
          <label>订正作者<select name="correctionAuthorKind" defaultValue={attempt?.correctionAuthorKind ?? "unknown"}>
            {Object.entries(correctionAuthorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <MarkdownEditor label="本次启发" name="insightMd" rows={4} value={notes.insightMd} onChange={(value) => updateNote("insightMd", value)} />
        </div>
      </details>
    </fieldset>
    <EditorActions label="保存作答" cancelHref={questionPath + "#attempts"} disabled={disabled} pending={pending} error={error} conflict={conflict}
      succeeded={succeeded} dirty={draft.dirty} savedHref={attempt ? `${questionPath}#attempt-${attempt.id}` : undefined} />
    {draft.confirmation}
  </form>;
}

type EditableState = LearningBadgeState & { nextReviewOn: string | null };
type SavedLearningState = { id: string; rowVersion: number; learningState: EditableState };

export function LearningStateEditor({ questionId, state, intervals }: {
  questionId: string; state: EditableState & { rowVersion: number }; intervals: ReviewIntervals;
}) {
  const [current, setCurrent] = useState(state);
  const [manual, setManual] = useState<EditableState>(state);
  const [recorded, setRecorded] = useState<ReviewAssessment | null>(null);
  const router = useRouter();
  const assessmentResult = useRef<HTMLSpanElement>(null);
  const { pending, disabled, error, conflict, succeeded, save } = useSave<SavedLearningState>(
    `/api/v1/questions/${questionId}/learning-state`, current.rowVersion,
  );
  const draft = useUnsavedChanges();
  const advancedChanged = manual.mastery !== current.mastery || manual.isMistake !== current.isMistake;
  const dateChanged = manual.nextReviewOn !== current.nextReviewOn;
  const manualChanged = advancedChanged || dateChanged;

  function changeManual(update: Partial<EditableState>) {
    const next = { ...manual, ...update };
    setManual(next);
    if (next.mastery !== current.mastery || next.isMistake !== current.isMistake || next.nextReviewOn !== current.nextReviewOn) draft.markDirty();
    else draft.markSaved();
  }

  async function saveState(assessment?: ReviewAssessment) {
    if (!assessment && !manualChanged) return;
    const saved = await save(assessment ? { assessment, nextReviewOn: dateChanged ? manual.nextReviewOn : undefined } : {
      mastery: manual.mastery, isMistake: manual.isMistake, nextReviewOn: manual.nextReviewOn,
    });
    if (!saved?.learningState) return;
    const next = saved.learningState;
    setCurrent({ ...next, rowVersion: saved.rowVersion });
    setManual(next);
    if (assessment) {
      setRecorded(assessment);
      requestAnimationFrame(() => assessmentResult.current?.focus({ preventScroll: true }));
    }
    draft.markSaved();
    window.dispatchEvent(new CustomEvent(learningStateChanged, { detail: { questionId, state: next } }));
    router.refresh();
  }

  return <div className="question-assessment" aria-busy={pending}>
    <p className="field-hint">{current.nextReviewOn ? <>下次复习 <time dateTime={current.nextReviewOn}>{current.nextReviewOn}</time></> : "尚未安排下次复习"}</p>
    {recorded ? <div className="actions">
      <span className="save-status" ref={assessmentResult} tabIndex={-1}>已记录 · {assessmentLabels[recorded]}</span>
      <button className="text-link" type="button" disabled={disabled} onClick={() => setRecorded(null)}>重新自评</button>
    </div> : <div className="actions review-assessment-options" aria-label="自评选项" role="group">
      {reviewAssessment.options.map((choice) => <button key={choice} type="button" className="button"
        disabled={disabled || advancedChanged} onClick={() => void saveState(choice)}>
        {assessmentLabels[choice]} <small>{dateChanged ? manual.nextReviewOn ?? "暂不安排" : `${intervals[choice]} 天后`}</small>
      </button>)}
    </div>}
    <details className="review-schedule-options">
      <summary>调整复习安排</summary>
      <form className="topic-editor" method="post" onSubmit={(event) => { event.preventDefault(); void saveState(); }}>
        <fieldset disabled={disabled}>
          <div className="editor-fields">
            <label>下次复习日期<input name="nextReviewOn" type="date" value={manual.nextReviewOn ?? ""}
              onChange={(event) => changeManual({ nextReviewOn: event.target.value || null })} /></label>
            <label>掌握状态<select name="mastery" value={manual.mastery}
              onChange={(event) => changeManual({ mastery: event.target.value as EditableState["mastery"] })}>
              {Object.entries(masteryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>
          <label className="check-field"><input type="checkbox" name="isMistake" checked={manual.isMistake}
            onChange={(event) => changeManual({ isMistake: event.target.checked })} />标记为错题</label>
          <div className="actions">
            <button className="button" type="submit" disabled={!manualChanged}>保存复习安排</button>
            {manualChanged && <button className="text-link" type="button" onClick={() => { setManual(current); draft.markSaved(); }}>放弃修改</button>}
          </div>
        </fieldset>
      </form>
    </details>
    <EditorFeedback pending={pending} error={error} conflict={conflict} succeeded={succeeded && !recorded && !manualChanged} dirty={manualChanged} savedHref={`/questions/${questionId}#learning-state`} />
    {draft.confirmation}
  </div>;
}

export function DeleteQuestion({ id, rowVersion }: { id: string; rowVersion: number }) {
  const navigateAfterSave = useNavigateAfterSave();
  const { pending, disabled, error, save } = useSave(`/api/v1/questions/${id}`, rowVersion, "DELETE");
  return <details className="create-panel danger-panel" suppressHydrationWarning>
    <summary><Trash2 size={16} aria-hidden="true" />移入回收站</summary>
    <form method="post" onSubmit={async (event) => {
      event.preventDefault();
      if (await save({})) navigateAfterSave(`/questions/${id}/revisions`, "已移入回收站");
    }}>
      <fieldset disabled={disabled}>
        <p>题目会从题库、搜索和复习入口移除。可在题目回收站恢复，作答和版本仍保留。</p>
        <button className="button danger" type="submit">{pending ? "正在删除…" : "确认删除"}</button>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </details>;
}

export function RestoreRevision({ url, version, revisionNo, returnTo }: {
  url: string; version: number; revisionNo: number; returnTo: string;
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const { pending, disabled, error, save } = useSave(url, version, "POST");
  return <form className="revision-action" method="post" onSubmit={async (event) => {
    event.preventDefault();
    if (await save({ revisionNo })) navigateAfterSave(returnTo);
  }}>
    <button className="button" type="submit" disabled={disabled}><Undo2 size={16} aria-hidden="true" />
      {pending ? "正在恢复…" : "恢复此版本内容"}
    </button>
    <p className="field-hint">恢复后会保存为一个新版本。</p>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

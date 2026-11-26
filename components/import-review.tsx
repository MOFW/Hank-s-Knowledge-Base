"use client";

import { AppLink } from "@/components/app-link";
import { useRouter } from "next/navigation";
import { TechnicalDetails } from "./technical-details";
import { useRef, useState, useSyncExternalStore } from "react";
import { AiReviewReport } from "@/components/ai-review-report";
import { batchReviewLimit } from "@/domain/ai-review";
import type { reviewHistory } from "@/services/ai-review";
import { ImportEvidenceQuotes } from "@/components/import-evidence-quotes";
import { Markdown } from "@/components/markdown";
import { QuestionTitle } from "@/components/question-title";
import { OriginalQuestionImages } from "@/components/question-reading";
import { SolutionReader } from "@/components/solution-reader";
import { importTextKind, importTextLabels, layersImportQuestions, projectImportSolution, sourcedNoteFields } from "@/domain/import-solution";
import { solutionAnnotationPositions } from "@/lib/solution-anchors";
import { contextImportNamespace, contextSourceLabel } from "@/domain/context-reference";
import { historyImportNamespace } from "@/domain/history-reference";
import { importCommitStatuses, importReviewStatuses } from "@/domain/import-status";
import type { ImportCandidate, ImportMapping, TopicImportCandidate } from "@/domain/imports";
import { chapterOptions, chapterTrail } from "@/lib/directory";
import { displayDateTime } from "@/lib/learning-display";
import { maxImageBytes } from "@/lib/image-signatures";
import type { ImportDetail } from "@/services/imports";

type Item = ImportDetail["items"][number];
type Decision = "approve" | "reject" | "skip";
type Edit = (patch: { mapping?: ImportMapping; candidate?: unknown }) => Promise<boolean>;
type ApiError = { message?: string; fields?: { path: string; message: string }[] };
type CommitItem = { itemId: string; rowVersion: number };
type CommitOutcome = CommitItem & Pick<Item, "status" | "issue">;
type Feedback = { message: string; error?: boolean; itemId?: string };
type ReviewChoice = CommitItem & { action: Decision; planHash?: string; acknowledgeDuplicates?: boolean };
class ImportWriteError extends Error {}

const statusLabels = {
  pending: "待审核", approved: "已批准，待入库", rejected: "已拒绝", skipped: "已跳过",
  conflict: "提交冲突", failed: "提交失败，可重试", committed: "已入库",
};
const actionLabels = { approve: "批准", reject: "拒绝", skip: "跳过", edit: "修订", conflict: "冲突", failed: "失败", commit: "入库" };
const duplicateLabels = {
  statement: "题干相同", image: "原图相同", title: "同课程同名", external_id: "外部标识相同", batch: "批次内相同",
  topic_title: "同课程同名", topic_similar: "同课程名称相似",
};
const subscribe = () => () => {};
const fields = {
  primaryCourseId: "主课程", title: "标题", statementMd: "题干", finalAnswerMd: "答案",
  solutionSteps: "分步解答", solutionDocument: "连续解答", solutionLayers: "追问、替代解法与整题补充", keyTechniquesMd: "技巧",
  difficulty: "难度", sourceDate: "来源日期", sourceTitle: "来源", sourceLocator: "来源位置", topicIds: "知识点", originalAssetIds: "原题图",
};
const sectionLabels = {
  definition: "定义与基本概念", formula: "公式", theorem: "定理", proof: "证明",
  intuition: "直观理解", derivation: "推导依据", method: "解题方法",
};
const originLabels = { quoted: "原文", transcribed: "转录", source_summary: "来源归纳", ai_generated: "AI 生成" };
const sourceLabels = { available: "可取得", partial: "仅有部分资料", unavailable: "无法取得" };

function isTopicCandidate(candidate: Item["candidate"]): candidate is TopicImportCandidate {
  return "kind" in candidate && candidate.kind === "topic";
}

function chapterName(batch: ImportDetail, chapterId: string | null) {
  return chapterTrail(batch.chapters, chapterId).map(({ title }) => title).join(" / ") || "未分类";
}

type AiHistory = Awaited<ReturnType<typeof reviewHistory>>;
export function ImportReview({ initial, initialAi }: { initial: ImportDetail; initialAi: AiHistory }) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [batch, setBatch] = useState(initial);
  const [ai, setAi] = useState(initialAi);
  const [aiSelected, setAiSelected] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [duplicates, setDuplicates] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<string>();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>();
  const busy = useRef(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const endpoint = `/api/v1/imports/${batch.id}`;
  const selected = Object.keys(decisions).length;
  const approved = batch.items.filter((item) => item.approvalCurrent && item.canApprove && importCommitStatuses.includes(item.status))
    .sort((a, b) => Number(a.kind === "topic") - Number(b.kind === "topic"));
  const committed = batch.items.filter(({ status }) => status === "committed").length;
  const waiting = batch.items.filter(({ status }) => importReviewStatuses.includes(status)).length;

  async function refresh() {
    const [response, aiResponse] = await Promise.all([fetch(endpoint), fetch(endpoint + "/ai-review")]);
    if (!response.ok) throw new Error();
    const { data } = await response.json() as { data: ImportDetail };
    const unchanged = new Set(data.items.filter((item) => {
      const before = batch.items.find(({ id }) => id === item.id);
      return before?.rowVersion === item.rowVersion && before.planHash === item.planHash
        && before.canApprove === item.canApprove
        && JSON.stringify(before.duplicates) === JSON.stringify(item.duplicates);
    }).map(({ id }) => id));
    setDecisions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => unchanged.has(id))));
    setDuplicates((current) => Object.fromEntries(Object.entries(current).filter(([id]) => unchanged.has(id))));
    setBatch(data);
    if (aiResponse.ok) setAi((await aiResponse.json() as { data: AiHistory }).data);
    setAiSelected((current) => current.filter((id) => data.items.some((item) => item.id === id && item.status === "pending" && unchanged.has(id))));
    return data;
  }

  async function write<T = { items?: CommitOutcome[] }>(path: string, body: object, version?: number) {
    const raw = JSON.stringify(body);
    const signature = JSON.stringify([path, version, raw]);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    const headers = new Headers({ "Content-Type": "application/json", "Idempotency-Key": attempt.current.key });
    if (version !== undefined) headers.set("If-Match", `"v${version}"`);
    const response = await fetch(endpoint + path, { method: version === undefined ? "POST" : "PATCH", headers, body: raw });
    const payload = await response.json() as { data?: T; error?: ApiError };
    if (!response.ok) {
      const fields = payload.error?.fields;
      throw new ImportWriteError(Array.isArray(fields) && fields.length ? fields.map(({ path, message }) => `${path} ${message}`).join("\n")
        : payload.error?.message ?? "操作未完成。");
    }
    if (!payload.data) throw new TypeError();
    router.refresh();
    return payload.data;
  }

  function failureMessage(error: unknown) {
    return error instanceof ImportWriteError ? error.message : "未收到完整结果。请核对当前状态，或重试相同操作。";
  }

  async function run(operation: () => Promise<Feedback>, itemId?: string) {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setFeedback(undefined);
    setConfirming(undefined);
    let result: Feedback;
    try {
      result = await operation();
    } catch (error) {
      result = { message: failureMessage(error), error: true };
    }
    const succeeded = !result.error;
    try {
      await refresh();
    } catch {
      result = { message: `${result.message} 页面未能刷新，请重新加载核对。`, error: true };
    } finally {
      setFeedback({ ...result, itemId });
      busy.current = false;
      setPending(false);
    }
    return succeeded;
  }

  async function commit(items: CommitItem[], single = false): Promise<Feedback> {
    const response = await write("/commit", { items });
    if (!response.items?.length) throw new TypeError();
    if (single) {
      const [item] = response.items;
      if (item.status === "committed") return { message: "已入库。" };
      return { error: true, message: item.issue?.message ?? `本次未入库。当前状态为「${statusLabels[item.status]}」，请核对后操作。` };
    }
    const finished = response.items.filter(({ status }) => status === "committed").length;
    return { message: `本次 ${finished}/${items.length} 项已入库。${finished < items.length ? "请查看未入库项的状态和原因。" : ""}` };
  }

  function reviewChoice(item: Item, action: Decision): ReviewChoice {
    const selection = { itemId: item.id, rowVersion: item.rowVersion, action };
    return action === "approve" ? { ...selection, planHash: item.planHash, acknowledgeDuplicates: duplicates[item.id] } : selection;
  }

  function commitSingle(item: Item, approve: boolean) {
    void run(async () => {
      if (approve) await write("/review", { decisions: [reviewChoice(item, "approve")] });
      try {
        // A new approval increments the reviewed version once. Never commit a different review from a refresh.
        const result = await commit([{ itemId: item.id, rowVersion: item.rowVersion + Number(approve) }], true);
        return approve && result.error ? { ...result, message: `批准已保存。入库未完成。${result.message}` } : result;
      } catch (error) {
        throw new ImportWriteError(approve ? `批准已保存。${failureMessage(error)}` : failureMessage(error));
      }
    }, item.id);
  }

  function requestAi(items: Item[], itemId?: string) {
    void run(async () => {
      const results = await write<{ status: string }[]>("/ai-review", {
        items: items.map(({ id, rowVersion }) => ({ itemId: id, rowVersion })),
      });
      attempt.current = null;
      const complete = results.filter(({ status }) => ["complete", "auto_committed"].includes(status)).length;
      return { message: complete ? `DeepSeek 已完成 ${complete}/${items.length} 项，请查看结果。`
        : "本次未生成新报告。请查看候选状态、执行记录或 DeepSeek 设置。" };
    }, itemId);
  }

  function showFeedback(itemId?: string) {
    if (!feedback || feedback.itemId !== itemId) return null;
    return <p className={feedback.error ? "import-error" : "field-hint"} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>;
  }

  function clearDecision(id: string) {
    setDecisions((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    setDuplicates((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
  }

  return <>
    <section className="import-actions" aria-label="批次操作">
      {batch.namespace === contextImportNamespace && <p className="field-hint">{contextSourceLabel}。请核对引句、发言归属及缺失资料。</p>}
      {batch.namespace === historyImportNamespace && <p className="field-hint">历史档案批次</p>}
      <p className="field-hint">共 {batch.items.length} 项 · 待审 {waiting} 项 · 已入库 {committed}/{batch.items.length} · 可提交入库 {approved.length} 项</p>
      <div className="actions">
        <button type="button" className="button" disabled={!ready || pending || selected === 0} onClick={async () => {
          const chosen = batch.items.flatMap((item) => {
            const action = decisions[item.id];
            if (!action || item.status === "committed") return [];
            return [reviewChoice(item, action)];
          });
          if (chosen.length && await run(async () => {
            await write("/review", { decisions: chosen });
            return { message: "审核决定已保存。" };
          })) {
            setDecisions({});
            setDuplicates({});
          }
        }}>保存审核决定{selected > 0 && `（${selected}）`}</button>
        <button type="button" className="button primary" disabled={!ready || pending || approved.length === 0} onClick={() => {
          void run(() => commit(approved.slice(0, 8).map(({ id, rowVersion }) => ({ itemId: id, rowVersion }))));
        }}>{approved.length > 8 ? "提交前 8 项入库" : `提交已批准的 ${approved.length} 项`}</button>
      </div>
      {ai.enabled && <button type="button" className="button" disabled={!ready || pending || !aiSelected.length}
        onClick={() => requestAi(batch.items.filter(({ id }) => aiSelected.includes(id)))}>
        审核所选候选（{aiSelected.length}/{batchReviewLimit}）
      </button>}
      {showFeedback()}
    </section>
    <ul className="import-items">
      {batch.items.map((item) => {
        const candidate = item.candidate;
        const topic = isTopicCandidate(candidate) ? candidate : undefined;
        const merging = Boolean(topic && (item.topicPlan?.target || topic.operation === "propose_update"));
        const confirmsAttempt = batch.namespace === contextImportNamespace && !isTopicCandidate(candidate) && candidate.attempts?.length;
        const approval = topic ? merging ? "合并补充" : "批准创建" : confirmsAttempt ? "批准并确认本人作答" : "批准";
        const title = candidate.title ?? item.topicPlan?.current?.title ?? item.currentTargetTitle ?? (topic ? "待命名笔记" : "待命名题目");
        const operation = topic ? merging ? "补充已有知识点" : "新建知识点"
          : candidate.operation === "create" ? "新增题目" : "补充已有题目";
        const course = topic && batch.courses.find(({ id }) => id === item.courseId);
        const chapter = topic && item.topicPlan?.chapterId !== undefined ? chapterName(batch, item.topicPlan.chapterId) : undefined;
        const currentApproval = item.approvalCurrent && importCommitStatuses.includes(item.status);
        const canApprove = item.canApprove && !currentApproval && (!item.duplicates.length || duplicates[item.id]);
        const waitingForQuestions = item.topicPlan?.relatedQuestions.some(({ id }) => !id);
        const choice = decisions[item.id];
        const quickAction = canApprove ? "批准并入库" : item.status === "failed" ? "重试此项入库" : "提交此项入库";
        const confirmId = `confirm-${item.id}`;
        const actions: { value: Decision; label: string }[] = [
          ...(canApprove ? [{ value: "approve" as const, label: approval }] : []),
          ...(item.status === "rejected" ? [] : [{ value: "reject" as const, label: "拒绝" }]),
          ...(item.status === "skipped" ? [] : [{ value: "skip" as const, label: "跳过" }]),
        ];
        const edit: Edit = async (patch) => {
          const ok = await run(async () => {
            await write(`/items/${item.id}`, patch, item.rowVersion);
            return { message: "候选已更新，请重新核对预览。" };
          }, item.id);
          if (ok) clearDecision(item.id);
          return ok;
        };
        return <li key={item.id} id={`item-${item.id}`} className="create-panel import-item">
        <header className="import-item-head">
          <div>
            <h2>{topic ? title : <QuestionTitle text={title} />}</h2>
            <p className="field-hint">{operation} · {item.needsVerification && item.status === "pending" ? "待核实" : statusLabels[item.status]}</p>
            {course && <p className="field-hint">{[course.name, chapter].filter(Boolean).join(" / ")}</p>}
          </div>
          {item.status === "committed" && <AppLink className="text-link" href={topic ? `/topics/${item.topicId}` : `/questions/${item.questionId}`}>
            查看{topic ? "知识点" : "题目"} · 版本 {item.committedVersion}</AppLink>}
        </header>
        {item.status !== "committed" && <div className="import-item-actions">
          {item.canApprove && !waitingForQuestions && choice !== "skip" && choice !== "reject" && (canApprove || currentApproval)
            && <>
              <button type="button" className="button primary" disabled={!ready || pending} aria-controls={confirmId}
                aria-expanded={confirming === item.id} onClick={() => setConfirming(confirming === item.id ? undefined : item.id)}>{quickAction}</button>
              <div id={confirmId} className="import-confirm" hidden={confirming !== item.id}>
                <p>此操作会正式写入{topic ? "课程知识点" : "题库"}。</p>
                <div className="actions">
                  <button type="button" className="button primary" disabled={!ready || pending}
                    onClick={() => commitSingle(item, Boolean(canApprove))}>确认{quickAction}</button>
                  <button type="button" className="button" onClick={() => setConfirming(undefined)}>取消</button>
                </div>
              </div>
            </>}
          <details className="import-decisions" suppressHydrationWarning>
            <summary>批量审核决定{choice && `（已选${actions.find(({ value }) => value === choice)?.label ?? actionLabels[choice]}）`}</summary>
            <div className="actions" role="group" aria-label={`${title}的批量审核决定`}>
              {actions.map(({ value, label }) => <button key={value} type="button" className="button small" aria-pressed={choice === value}
                disabled={!ready || pending} onClick={() => {
                  if (choice === value) {
                    setDecisions((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id)));
                  } else setDecisions((current) => ({ ...current, [item.id]: value }));
                }}>{label}</button>)}
            </div>
          </details>
          {waitingForQuestions && <p className="field-hint">单项入库前请先提交关联的同批题目。</p>}
          {importCommitStatuses.includes(item.status) && !currentApproval && <p className="field-hint">审核计划已有变更，请重新核对并批准。</p>}
          {item.issues.some(({ code }) => code === "UNRESOLVED_COURSE" || code === "AMBIGUOUS_COURSE") &&
            <p className="field-hint">批准前请<a className="text-link" href={`#course-${item.id}`} onClick={(event) => {
              const field = document.getElementById(`course-${item.id}`);
              const editor = field?.closest("details");
              if (!field || !editor) return;
              event.preventDefault();
              editor.open = true;
              field.focus();
            }}>选择{topic ? "所属课程" : "主课程"}</a>。</p>}
          {confirmsAttempt ? <p className="field-hint">批准此项同时确认候选中的本人作答。</p> : null}
        </div>}
        {item.status === "pending" && ai.enabled && <div className="actions">
          <button type="button" className="button" disabled={!ready || pending} onClick={() => requestAi([item], item.id)}>
            {ai.runs.some((run) => run.itemId === item.id && run.state !== "queued") ? "重新审核" : "使用 DeepSeek 审核"}
          </button>
          <label><input type="checkbox" checked={aiSelected.includes(item.id)}
            disabled={!ready || pending || (!aiSelected.includes(item.id) && aiSelected.length >= batchReviewLimit)}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setAiSelected((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id));
            }} /> 加入 DeepSeek 批量审核</label>
        </div>}
        {ai.runs.filter(({ itemId }) => itemId === item.id).map((run) =>
          <AiReviewReport key={run.id} run={run} currentVersion={item.rowVersion} />)}
        {showFeedback(item.id)}
        {item.issue && !(feedback?.itemId === item.id && feedback.message.includes(item.issue.message)) &&
          <p className="import-error">{item.issue.message}</p>}
        {item.issues.length > 0 && <ul className="import-issues">{item.issues.map(({ path, code, message, severity }, index) => (
          <li key={`${path}-${code}-${index}`}><strong>{severity === "blocking" ? "待核实" : "提示"}</strong> {message} {path && <code>{path}</code>}</li>
        ))}</ul>}
        {item.duplicates.length > 0 && <details className="import-detail" open suppressHydrationWarning>
          <summary>{topic ? "可能重复的知识点" : "可能重复的题目"}（{item.duplicates.length}）</summary>
          <ul className="import-duplicates">{item.duplicates.map(({ id, title, excerpt, reason, version }) => {
            const match = topic && !merging && version && batch.topics.find((choice) => choice.id === id && choice.courseId === item.courseId);
            return <li key={`${id}-${reason}`}>
              <AppLink className="text-link" href={reason === "batch" ? `#item-${id}` : topic ? `/topics/${id}` : `/questions/${id}`}>{topic ? title : <QuestionTitle text={title} />}</AppLink>
              <span className="field-hint"> · {duplicateLabels[reason]}</span>
              {excerpt && <p>{excerpt}</p>}
              {match && version && <button type="button" className="button small import-match-action" disabled={!ready || pending}
                onClick={() => {
                  const mapping = { ...item.mapping, topicTarget: { topicId: id, expectedVersion: version } };
                  delete mapping.chapterId;
                  void edit({ mapping });
                }}>选择为补充目标</button>}
            </li>;
          })}</ul>
          <label className="check-field"><input type="checkbox" checked={Boolean(duplicates[item.id])} disabled={!ready || pending}
            onChange={(event) => {
              if (!event.target.checked && decisions[item.id] === "approve") clearDecision(item.id);
              setDuplicates((current) => ({ ...current, [item.id]: event.target.checked }));
            }} />我已核对可能重复的条目</label>
        </details>}
        {topic && item.topicPlan?.target && item.topicPlan.current
          && item.topicPlan.target.expectedVersion !== item.topicPlan.current.rowVersion
          && <TopicRebase item={item} pending={!ready || pending} edit={edit} />}
        <details className="import-detail" open={topic && item.status !== "committed" && (merging || batch.items.length === 1) ? true : undefined} suppressHydrationWarning>
          <summary>{topic ? "预览笔记与证据" : "预览题干、解答与证据"}</summary>
          {isTopicCandidate(candidate) ? <TopicPreview item={item} batch={batch} candidate={candidate} />
            : <ItemPreview item={item} batch={batch} candidate={candidate} />}
        </details>
        {item.status !== "committed" && item.historyImages.some((image) => !image.assetId) &&
          <HistoryImageUploads item={item} disabled={!ready || pending} onUploaded={refresh} />}
        {item.status !== "committed" && <ImportMappingEditor key={item.rowVersion} item={item} batch={batch} pending={!ready || pending} edit={edit} />}
      </li>;
      })}
    </ul>
    {batch.history.length > 0 && <details className="import-detail" suppressHydrationWarning>
      <summary>最近审核记录</summary>
      <ul className="import-duplicates">{batch.history.map(({ itemId, itemVersion, action, createdAt, reviewer }) => <li key={`${itemId}-${itemVersion}`}>
        <a className="text-link" href={`#item-${itemId}`}>{batch.items.find(({ id }) => id === itemId)?.candidate.item_key}</a>
        <span className="field-hint"> · {reviewer === "system:deepseek" ? "DeepSeek 自动" : "人工"}{actionLabels[action]} · {displayDateTime(createdAt)}</span>
      </li>)}</ul>
    </details>}
  </>;
}

function TopicRebase({ item, pending, edit }: { item: Item; pending: boolean; edit: Edit }) {
  const { current, target } = item.topicPlan ?? {};
  if (!current || !target) return null;
  return <div className="import-rebase">
    <p>候选基于版本 {target.expectedVersion}。<AppLink className="text-link" href={`/topics/${current.id}`}>{current.title}</AppLink>已更新到版本 {current.rowVersion}。</p>
    <button type="button" className="button small" disabled={pending} onClick={() => {
      void edit({ mapping: { ...item.mapping, topicTarget: { topicId: current.id, expectedVersion: current.rowVersion } } });
    }}>按当前版本重新生成预览</button>
  </div>;
}

function NotePreview({ label, note }: { label: string; note: { summaryMd: string; bodyMd: string } }) {
  const [open, setOpen] = useState(false);
  return <details className="import-detail" suppressHydrationWarning onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{label}</summary>
    {open && <div className="import-preview">
      {note.summaryMd.trim() && <section><h4>摘要</h4><Markdown source={note.summaryMd} /></section>}
      {note.bodyMd.trim() ? <Markdown source={note.bodyMd} /> : <p className="empty">暂无正文。</p>}
    </div>}
  </details>;
}

// The merge inserts whole lines. Ignore blank lines so spacing changes don't hide an insertion.
function noteAdditions(before: string, after: string) {
  const original = before.split(/\r\n?|\n/).filter((line) => line.trim());
  const additions: { line: number; text: string }[] = [];
  let cursor = 0;
  let start = 0;
  let lines: string[] = [];
  function flush() {
    const text = lines.join("\n").trimEnd();
    if (text.trim()) additions.push({ line: start, text });
    lines = [];
  }
  after.split(/\r\n?|\n/).forEach((line, index) => {
    if (line.trim() && line === original[cursor]) {
      flush();
      cursor++;
    } else if (lines.length || line.trim()) {
      if (!lines.length) start = index + 1;
      lines.push(line);
    }
  });
  flush();
  return cursor === original.length ? additions : null;
}

function CandidateJson({ candidate }: { candidate: Item["candidate"] }) {
  return <details className="import-detail" suppressHydrationWarning>
    <summary>查看候选字段和原文引句</summary><pre className="import-raw-json" tabIndex={0}>{JSON.stringify(candidate, null, 2)}</pre>
  </details>;
}

function TopicPreview({ item, batch, candidate }: { item: Item; batch: ImportDetail; candidate: TopicImportCandidate }) {
  const { current, preview, relatedTopics = [], relatedQuestions = [] } = item.topicPlan ?? {};
  const additions = current && preview ? noteAdditions(current.bodyMd, preview.bodyMd) : undefined;
  const summaryAdded = current && preview && preview.summaryMd !== current.summaryMd;
  const sources = new Set(candidate.source_keys ?? []);
  const content = [candidate.summary, ...(candidate.sections ?? []).map(({ content }) => content)];
  for (const part of [...content, ...(candidate.learner_questions ?? []), ...(candidate.evidenced_mistakes ?? [])]) {
    part?.evidence?.forEach(({ source_key }) => sources.add(source_key));
  }
  const evidenceBlocked = (path: string) => item.issues.some((issue) =>
    issue.severity === "blocking" && issue.path.startsWith(path + "/evidence/"));
  return <div className="import-preview">
    {current && <section className="import-note-diff">
      <p className="field-hint">补充目标 · <AppLink className="text-link" href={`/topics/${current.id}`}>{current.title}</AppLink></p>
      <h3>新增内容</h3>
      {preview ? <>
        {summaryAdded && <div><h4>摘要</h4><Markdown source={preview.summaryMd} /></div>}
        {additions?.map(({ line, text }) => <div key={line} className="import-added">
          <p className="field-hint">合并后第 {line} 行起</p><pre tabIndex={0}>{text}</pre>
        </div>)}
        {additions === null && <p className="field-hint">展开原笔记和合并后的笔记核对正文差异。</p>}
        {additions?.length === 0 && !summaryAdded && <p className="field-hint">摘要与正文没有新增内容。下方列出候选来源和关联。</p>}
      </> : <p className="field-hint">核对目标后可生成合并预览。</p>}
      <NotePreview label={`原笔记 · 版本 ${current.rowVersion}`} note={current} />
      {preview && <NotePreview label="合并后笔记" note={preview} />}
    </section>}
    {!current && preview && <NotePreview label="收录后笔记" note={preview} />}
    {candidate.summary && <section><h3>候选摘要</h3><p className="field-hint">{originLabels[candidate.summary.origin]}</p>
      <Markdown source={candidate.summary.markdown} /><ImportEvidenceQuotes evidence={candidate.summary.evidence} sources={batch.sources} />
    </section>}
    {candidate.sections?.map(({ id, kind, title, content }) => <section key={id}>
      <h3>{title || sectionLabels[kind]}</h3>
      <p className="field-hint">{title ? `${sectionLabels[kind]} · ` : ""}{originLabels[content.origin]}</p>
      <Markdown source={content.markdown} /><ImportEvidenceQuotes evidence={content.evidence} sources={batch.sources} />
    </section>)}
    {candidate.learner_questions?.map(({ id, question_md, evidence }) => <section key={`question-${id}`}>
      <h3>{evidenceBlocked(`/learner_questions/${id}`) ? "待核实的学习者疑问" : "有原文证据的学习者疑问"}</h3>
      <Markdown source={question_md} /><ImportEvidenceQuotes evidence={evidence} sources={batch.sources} />
    </section>)}
    {candidate.evidenced_mistakes?.map(({ id, description_md, evidence }) => <section key={`mistake-${id}`}>
      <h3>{evidenceBlocked(`/evidenced_mistakes/${id}`) ? "待核实的学习者错误" : "有原文证据的学习者错误"}</h3>
      <Markdown source={description_md} /><ImportEvidenceQuotes evidence={evidence} sources={batch.sources} />
    </section>)}
    {candidate.ai_notes_md && <section><h3>AI 整理备注</h3><Markdown source={candidate.ai_notes_md} /></section>}
    {relatedTopics.length > 0 && <section><h3>相关知识点</h3><ul className="import-duplicates">
      {relatedTopics.map(({ id, title }) => <li key={id}><AppLink className="text-link" href={`/topics/${id}`}>{title}</AppLink></li>)}
    </ul></section>}
    {relatedQuestions.length > 0 && <section><h3>关联题目</h3><ul className="import-duplicates">
      {relatedQuestions.map(({ id, title, itemKey }) => {
        const candidate = itemKey && batch.items.find(({ candidate }) => candidate.item_key === itemKey);
        const heading = <QuestionTitle text={title} />;
        return <li key={itemKey ?? id}>{id ? <AppLink className="text-link" href={`/questions/${id}`}>{heading}</AppLink>
          : candidate ? <a className="text-link" href={`#item-${candidate.id}`}>{heading} · 同批题目候选</a> : heading}</li>;
      })}
    </ul></section>}
    {sources.size > 0 && <section><h3>来源</h3><ul className="import-duplicates">
      {batch.sources.filter(({ source_key }) => sources.has(source_key)).map((source) => <li key={source.source_key}>
        {source.title} · {sourceLabels[source.acquisition_status]}{source.occurred_on && ` · ${source.occurred_on}`}
        {source.external_url && /^https?:\/\//i.test(source.external_url) && <> · <a className="text-link" href={source.external_url} target="_blank" rel="noreferrer">打开来源</a></>}
      </li>)}
    </ul></section>}
    <CandidateJson candidate={candidate} />
  </div>;
}

function ItemPreview({ item, batch, candidate }: { item: Item; batch: ImportDetail; candidate: ImportCandidate }) {
  const document = candidate.solution_document;
  const layered = layersImportQuestions(batch.namespace);
  const scope = `import-${item.id}`;
  const readerDocument = projectImportSolution(candidate, layered, (refs, path) =>
    [...new Set((refs ?? []).flatMap((ref, index) => {
      const selected = item.topicMappings.find((row) => row.path === `${path}/topic_refs/${index}`)?.selected;
      return selected ? [selected] : item.status === "committed" && "id" in ref ? [ref.id] : [];
    }))]);
  const positions = readerDocument ? solutionAnnotationPositions(readerDocument.bodyMd) : new Map<string, number | undefined>();
  const locatedNotes = (readerDocument?.annotations ?? []).filter((note) => positions.has(note.id) &&
    (note.learnerQuestionsMd?.length || note.topicIds.length || [
      note.basisMd, note.strategyMd, note.explanationMd, note.aiExplanationMd, note.commonMistakesMd,
    ].some((md) => md.trim())));
  const rank = new Map([...positions.keys()].map((id, index) => [id, index]));
  locatedNotes.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const shown = new Set(locatedNotes.map(({ id }) => id));
  const questions = candidate.learner_questions ?? [];
  const placementGap = (id: string) => (candidate.gaps ?? []).some(({ field_path }) =>
    field_path === `/learner_questions/${id}` || field_path.startsWith(`/learner_questions/${id}/`));
  const annotationDetails = Object.fromEntries((document?.annotations ?? []).map((note) => [note.id, <>
    {questions.filter(({ annotation_id }) => annotation_id === note.id).map(({ id, question_md, evidence }) => <div key={id}>
      {!layered && <><p className="solution-note-label">学习者疑问</p><Markdown source={question_md} /></>}
      <p className="field-hint">追问引句{placementGap(id) && " · 位置待核实"}</p>
      <ImportEvidenceQuotes evidence={evidence} sources={batch.sources} />
    </div>)}
    {sourcedNoteFields.map(([key, , label]) => {
      const text = note[key];
      return text?.evidence?.length ? <div key={key}>
        <p className="field-hint">{label} · {importTextLabels[importTextKind(text)]}</p>
        <ImportEvidenceQuotes evidence={text.evidence} sources={batch.sources} />
      </div> : null;
    })}
  </>]));
  const relevantSourceKeys = new Set(candidate.source_keys ?? []);
  function collectSources(value: unknown) {
    if (!value || typeof value !== "object") return;
    if ("source_key" in value && typeof value.source_key === "string") relevantSourceKeys.add(value.source_key);
    Object.values(value).forEach(collectSources);
  }
  collectSources(candidate);
  return <div className="import-preview">
    {candidate.statement && <section><h3>题干</h3><Markdown source={candidate.statement.markdown} />
      <ImportEvidenceQuotes evidence={candidate.statement.evidence} sources={batch.sources} /></section>}
    <OriginalQuestionImages ids={[...new Set([
      ...candidate.original_asset_ids ?? [], ...item.historyImages.flatMap(({ assetId }) => assetId ? [assetId] : []),
    ])]} />
    {document && <section><h3>主解答</h3>
      {item.changes.some(({ field, preserved }) => field === "solutionDocument" && preserved) &&
        <p className="field-hint">以下是候选解答。此次更新会保留现有的正式解答。</p>}
      {locatedNotes.length > 0 && <div>
        <p className="field-hint">步骤注释（按正文顺序）</p>
        <ol>{locatedNotes.map(({ id, label }) => <li key={id}>
          <a className="text-link" href={`#solution-${scope}-marker-${id}`}>{label ?? id}</a>
          <span className="field-hint">{` · 正文第 ${positions.get(id)} 行`}</span>
        </li>)}</ol>
      </div>}
      <SolutionReader scope={scope} topics={batch.topics} steps={[]} review
        answerMd="" document={readerDocument} annotationDetails={annotationDetails} />
      <ImportEvidenceQuotes evidence={document.body.evidence} sources={batch.sources} />
      {document.annotations?.filter(({ id }) => !shown.has(id)).map((note) => <details key={note.id}>
        <summary>未显示在正文的注释：{note.label ?? note.id}</summary>
        {sourcedNoteFields.map(([key, , label]) => note[key] && <div key={key}>
          <p className="solution-note-label">{label} · {importTextLabels[importTextKind(note[key])]}</p>
          <Markdown source={note[key].markdown} />
        </div>)}
        {note.ai_explanation_md && <><p className="solution-note-label">AI 补充说明</p><Markdown source={note.ai_explanation_md} /></>}
        {annotationDetails[note.id]}
      </details>)}
    </section>}
    {candidate.final_answer && <section><h3>答案</h3><Markdown source={candidate.final_answer.markdown} />
      <ImportEvidenceQuotes evidence={candidate.final_answer.evidence} sources={batch.sources} /></section>}
    {candidate.key_techniques && <section><h3>整题补充</h3><Markdown source={candidate.key_techniques.markdown} />
      <ImportEvidenceQuotes evidence={candidate.key_techniques.evidence} sources={batch.sources} /></section>}
    {candidate.solution_steps?.map((step) => <section key={step.id}><h3>{step.title}</h3><Markdown source={step.body.markdown} /></section>)}
    {candidate.attempts?.map((attempt) => <section key={attempt.external_id}><h3>原始作答</h3><Markdown source={attempt.original_work.markdown} />
      <ImportEvidenceQuotes evidence={attempt.original_work.evidence} sources={batch.sources} /></section>)}
    {questions.filter(({ annotation_id }) => !annotation_id || !shown.has(annotation_id)).map((question) => <section key={question.id}>
      <h3>{question.annotation_id || placementGap(question.id) ? "待确认位置的学习者疑问" : "未关联步骤的学习者疑问"}</h3>
      <Markdown source={question.question_md} /><ImportEvidenceQuotes evidence={question.evidence} sources={batch.sources} />
    </section>)}
    {candidate.evidenced_mistakes?.map((note) => <section key={note.id}>
      <h3>{note.kind === "observed_learner_error" ? "有引文的作答错误候选" : "资料中的易错点"}</h3><Markdown source={note.description_md} />
      <ImportEvidenceQuotes evidence={note.evidence} sources={batch.sources} />
    </section>)}
    {candidate.ai_notes_md && <section><h3>AI 整理备注</h3><Markdown source={candidate.ai_notes_md} /></section>}
    {relevantSourceKeys.size > 0 && <section><h3>来源</h3><ul>
      {batch.sources.filter(({ source_key }) => relevantSourceKeys.has(source_key)).map((source) => <li key={source.source_key}>
        {source.title} · {sourceLabels[source.acquisition_status]}
        <TechnicalDetails fields={[["来源键", source.source_key]]} />
      </li>)}
    </ul></section>}
    {item.changes.length > 0 && <section><h3>字段比较</h3><ul className="import-changes">
      {item.changes.map(({ field, before, after, preserved }) => <li key={field}>
        <strong>{fields[field]} · {preserved ? "保留现有值" : "提交候选变更"}</strong>
        <div><span>现有</span><pre>{typeof before === "string" ? before : JSON.stringify(before, null, 2)}</pre></div>
        <div><span>候选</span><pre>{typeof after === "string" ? after : JSON.stringify(after, null, 2)}</pre></div>
      </li>)}
    </ul></section>}
    <CandidateJson candidate={candidate} />
  </div>;
}

function HistoryImageUploads({ item, disabled, onUploaded }: { item: Item; disabled: boolean; onUploaded: () => Promise<unknown> }) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = useRef(false);
  const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
  return <details className="import-detail" suppressHydrationWarning>
    <summary>核对并登记材料包原图</summary>
    <p className="field-hint">从材料包选择对应的原始文件。登记后可预览，批准并提交时才会关联到正式题目。</p>
    {item.historyImages.map((image, index) => {
      if (image.assetId) return null;
      const name = `${image.sha256}.${extensions[image.mime_type]}`;
      return <div key={index} className="import-map">
        <label>原图 {index + 1}<input type="file" accept={image.mime_type} disabled={disabled || uploading}
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            input.value = "";
            if (!file || busy.current) return;
            setError("");
            if (file.size !== image.byte_size || file.size > maxImageBytes) {
              setError("所选文件大小与材料包原图不一致。");
              return;
            }
            busy.current = true;
            setUploading(true);
            try {
              const response = await fetch("/api/v1/assets", {
                method: "POST",
                headers: { "Content-Type": image.mime_type, "X-File-Name": name, "X-Image-SHA256": image.sha256,
                  "Idempotency-Key": `history-image-${image.sha256}` },
                body: file,
              });
              const payload = await response.json() as { error?: ApiError };
              if (!response.ok) {
                setError(payload.error?.message ?? "无法登记图片。");
                return;
              }
              await onUploaded();
            } catch {
              setError("未收到完整结果。可以刷新，或重试同一张图片。");
            } finally {
              busy.current = false;
              setUploading(false);
            }
          }} /></label>
        <p className="field-hint"><code>{name}</code> · 原始附件序号 {image.attachment_index}<br /><code>{image.locator}</code></p>
      </div>;
    })}
    {uploading && <p className="field-hint" role="status">正在登记原图…</p>}
    {error && <p className="import-error" role="alert">{error}</p>}
  </details>;
}

function ImportMappingEditor({ item, batch, edit, pending }: { item: Item; batch: ImportDetail; edit: Edit; pending: boolean }) {
  const [json, setJson] = useState(() => JSON.stringify(item.candidate, null, 2));
  const [parseError, setParseError] = useState("");
  const [courseId, setCourseId] = useState(item.mapping.courseId ?? "");
  const [topicTargetId, setTopicTargetId] = useState(item.mapping.topicTarget?.topicId ?? "");
  const topic = isTopicCandidate(item.candidate) ? item.candidate : undefined;
  const target = item.topicPlan?.target;
  const inferredCourse = item.courseCandidates.length === 1 ? item.courseCandidates[0]
    : topic && !topic.course_ref ? batch.topics.find(({ id }) => id === target?.topicId)?.courseId : undefined;
  const selectedCourse = courseId || inferredCourse;
  const topicTargets = topic ? batch.topics.filter(({ courseId }) => courseId === selectedCourse) : [];
  const chapters = topic ? chapterOptions(batch.chapters.filter(({ courseId }) => courseId === selectedCourse)) : [];
  const explicitTarget = topicTargets.find(({ id }) => id === topicTargetId);
  const creating = topic?.operation === "create" && !explicitTarget;
  return <details className="import-detail" suppressHydrationWarning>
    <summary>修改映射或修订候选</summary>
    <form className="import-map" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const topicIdsByPath: NonNullable<ImportMapping["topicIdsByPath"]> = {};
      const mapping: ImportMapping = { ...(courseId && { courseId }), topicIdsByPath };
      for (const row of item.topicMappings) {
        const value = String(form.get(row.path) ?? "");
        if (value) topicIdsByPath[row.path] = value === "skip" ? null : value;
      }
      if (topic) {
        const chapterId = form.get("chapterId");
        if (typeof chapterId === "string" && chapterId) mapping.chapterId = chapterId === "unassigned" ? null : chapterId;
        if (explicitTarget) mapping.topicTarget = {
          topicId: explicitTarget.id,
          expectedVersion: target?.topicId === explicitTarget.id ? target.expectedVersion : explicitTarget.rowVersion,
        };
      } else if (item.target) {
        const questionId = String(form.get("targetId") ?? "").trim();
        const expectedVersion = Number(form.get("targetVersion"));
        if (questionId) mapping.target = { questionId, expectedVersion };
      }
      void edit({ mapping });
    }}>
      <fieldset disabled={pending}>
        <label>{topic ? "所属课程" : "主课程"}<select id={`course-${item.id}`} value={courseId} onChange={(event) => {
          setCourseId(event.target.value);
          setTopicTargetId("");
        }}>
          <option value="">{inferredCourse ? `按候选匹配：${batch.courses.find(({ id }) => id === inferredCourse)?.name ?? inferredCourse}` : "按候选匹配"}</option>
          {batch.courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select></label>
        {topic && <label>补充目标<select value={topicTargetId} disabled={!selectedCourse}
          onChange={(event) => setTopicTargetId(event.target.value)}>
          <option value="">{topic.operation === "create" ? "创建新知识点" : "使用候选指定的目标"}</option>
          {topicTargets.map(({ id, title, chapterPath, rowVersion }) => <option key={id} value={id}>
            {[...chapterPath, title].join(" / ")} · 版本 {rowVersion}
          </option>)}
        </select></label>}
        {creating && <label>所属章节<select key={selectedCourse} name="chapterId" disabled={!selectedCourse}
          defaultValue={item.mapping.chapterId === null ? "unassigned" : item.mapping.chapterId ?? ""}>
          <option value="">{topic.chapter_path?.length ? `按候选匹配：${topic.chapter_path.join(" / ")}` : "按候选匹配"}</option>
          <option value="unassigned">未分类</option>
          {chapters.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </select></label>}
        {item.topicMappings.map(({ path, ref, candidates, selected }) => <label key={path}>
          {"title" in ref ? ref.title : batch.topics.find(({ id }) => id === ref.id)?.title ?? ref.id}
          <code>{path}</code>
          <select name={path} defaultValue={item.mapping.topicIdsByPath?.[path] === null ? "skip" : item.mapping.topicIdsByPath?.[path] ?? ""}>
            <option value="">{candidates.length > 1 ? `有 ${candidates.length} 个同名匹配` : selected ? "按候选匹配" : "待匹配"}</option>
            <option value="skip">跳过此关联</option>
            {batch.topics.map((topic) => <option key={topic.id} value={topic.id}>
              {[topic.courseName, ...topic.chapterPath, topic.title].join(" / ")}{candidates.includes(topic.id) ? "（匹配）" : ""}
            </option>)}
          </select>
        </label>)}
        {!topic && item.target && <div className="import-target">
          <label>目标题目 ID<input name="targetId" defaultValue={item.target.questionId} required /></label>
          <label>预期版本<input name="targetVersion" type="number" min="1" required defaultValue={item.target.expectedVersion} /></label>
          {item.currentTargetVersion && <p className="field-hint">当前版本 {item.currentTargetVersion} · <AppLink className="text-link" href={`/questions/${item.target.questionId}`}>查看题目</AppLink></p>}
        </div>}
        <button type="submit" className="button">保存映射</button>
      </fieldset>
    </form>
    <details className="import-detail" suppressHydrationWarning>
      <summary>修订候选 JSON</summary>
      <form className="import-map" onSubmit={(event) => {
        event.preventDefault();
        try {
          const candidate: unknown = JSON.parse(json);
          setParseError("");
          void edit({ candidate });
        } catch {
          setParseError("候选 JSON 格式不正确。");
        }
      }}>
        <label>候选内容<textarea rows={12} value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} disabled={pending} /></label>
        <p className="field-hint">修订后请重新核对关联和审核决定。</p>
        {parseError && <p className="import-error" role="alert">{parseError}</p>}
        <button type="submit" className="button" disabled={pending}>保存候选修订</button>
      </form>
    </details>
  </details>;
}

"use client";


import { AppLink } from "@/components/app-link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Markdown } from "@/components/markdown";
import { QuestionTitle } from "@/components/question-title";
import { SolutionReader } from "@/components/solution-reader";
import { OriginalQuestionImages } from "@/components/question-reading";
import { StartReviewButton } from "@/components/review-entry";
import { cachedReviewDrafts, clearReviewDraft, draftPointer, pointToDraft, storeReviewDraft, type CachedReviewDraft } from "@/components/review-drafts";
import { assessmentLabels, reviewAssessment, type ReviewCommand } from "@/domain/review";
import type { ReviewSnapshot } from "@/services/review";

const subscribe = () => () => {};
const browserReady = () => true;
const serverReady = () => false;
type WithoutItem<T> = T extends ReviewCommand ? Omit<T, "position" | "draftMd"> : never;
type Command = WithoutItem<ReviewCommand>;
type Pending = { key: string; version: number; body: ReviewCommand };

export function ReviewRound({ ownerId, initial }: { ownerId: string; initial: ReviewSnapshot }) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, browserReady, serverReady);
  const [review, setReview] = useState(initial);
  const [draft, setDraft] = useState(initial.item?.draftMd ?? "");
  const [cached, setCached] = useState<CachedReviewDraft[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState<ReviewSnapshot | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [draftOpen, setDraftOpen] = useState(Boolean(initial.item?.draftMd));
  const [hintOpen, setHintOpen] = useState(Boolean(initial.item?.usedHint));
  const [overrideDate, setOverrideDate] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const assessmentResult = useRef<HTMLParagraphElement>(null);
  const running = useRef(false);
  const retryRef = useRef<Pending | null>(null);
  const cacheKey = useRef("");
  const recoveredKey = useRef("");
  const saved = useRef(initial);
  const input = useRef(initial.item?.draftMd ?? "");
  const endpoint = `/api/v1/review/sessions/${initial.session.id}`;
  const prefix = `hkb-review-draft:${ownerId}:${initial.session.id}:`;

  const adopt = useCallback((data: ReviewSnapshot, advance = false) => {
    const previous = saved.current;
    saved.current = data;
    input.current = data.item?.draftMd ?? "";
    setReview(data);
    setDraft(input.current);
    setCached(cachedReviewDrafts(prefix, data));
    if (previous.session.position !== data.session.position || !data.item) {
      cacheKey.current = "";
      recoveredKey.current = "";
      setDraftOpen(Boolean(input.current));
      setHintOpen(Boolean(data.item?.usedHint));
      setOverrideDate("");
      if (advance) requestAnimationFrame(() => heading.current?.focus());
    } else if (!previous.item?.usedHint && data.item.usedHint) {
      setHintOpen(true);
    }
  }, [prefix]);

  useEffect(() => {
    let mounted = true;
    const update = async () => {
      if (running.current) return;
      try {
        const response = await fetch(endpoint, { cache: "no-store" });
        if (!response.ok) return;
        const { data } = await response.json() as { data: ReviewSnapshot };
        if (!mounted || running.current || data.session.rowVersion < saved.current.session.rowVersion) return;
        if (data.session.rowVersion === saved.current.session.rowVersion &&
            Boolean(data.question) === Boolean(saved.current.question) &&
            data.item?.learningStateVersion === saved.current.item?.learningStateVersion) return;
        const changedSchedule = data.session.rowVersion === saved.current.session.rowVersion &&
          data.item?.learningStateVersion !== saved.current.item?.learningStateVersion;
        if (input.current !== (saved.current.item?.draftMd ?? "") || retryRef.current || changedSchedule) {
          setConflict(data);
          setMessage(changedSchedule ? "复习安排已在另一处更新。请先载入已保存的安排。" : "这轮复习已在另一处更新。请核对已保存进度。");
        } else {
          adopt(data);
        }
      } catch { /* Offline work stays in the current draft. */ }
    };
    const timer = window.setTimeout(() => {
      const drafts = cachedReviewDrafts(prefix, saved.current);
      const own = drafts.find((entry) => entry.key === draftPointer(prefix) && entry.version === saved.current.session.rowVersion);
      if (own && input.current === (saved.current.item?.draftMd ?? "")) {
        recoveredKey.current = own.key;
        input.current = own.text;
        setDraft(own.text);
        setDraftOpen(true);
      }
      setCached(drafts.filter(({ key }) => key !== recoveredKey.current));
    }, 0);
    window.addEventListener("pageshow", update);
    window.addEventListener("focus", update);
    void update();
    return () => {
      mounted = false;
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", update);
      window.removeEventListener("focus", update);
    };
  }, [adopt, endpoint, prefix]);

  function changeDraft(text: string) {
    input.current = text;
    setDraft(text);
    if (!cacheKey.current) cacheKey.current = prefix + crypto.randomUUID();
    if (text === (saved.current.item?.draftMd ?? "")) {
      clearReviewDraft(cacheKey.current);
      if (recoveredKey.current) clearReviewDraft(recoveredKey.current);
    } else {
      const stored = storeReviewDraft(cacheKey.current, saved.current, text);
      setStorageBlocked(!stored);
      if (stored) {
        if (recoveredKey.current) clearReviewDraft(recoveredKey.current);
        pointToDraft(prefix, cacheKey.current);
      }
    }
    recoveredKey.current = "";
  }

  async function send(request: Pending) {
    if (running.current) return;
    running.current = true;
    retryRef.current = request;
    setPending(request);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": request.key, "If-Match": `"v${request.version}"` },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json() as { data?: ReviewSnapshot; error?: { message?: string } };
      if (response.ok && payload.data) {
        if (cacheKey.current) clearReviewDraft(cacheKey.current);
        if (recoveredKey.current) clearReviewDraft(recoveredKey.current);
        recoveredKey.current = "";
        retryRef.current = null;
        setPending(null);
        setConflict(null);
        setConfirmEnd(false);
        adopt(payload.data, request.body.action === "next" || request.body.action === "skip" || request.body.action === "end");
        router.refresh();
        if (request.body.action === "assess") requestAnimationFrame(() => assessmentResult.current?.focus());
        if (request.body.action === "draft") setMessage("草稿已保存。");
      } else if (response.status === 409 || response.status === 422) {
        retryRef.current = null;
        setPending(null);
        const latest = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (!latest.ok) throw new Error();
        const { data } = await latest.json() as { data: ReviewSnapshot };
        if (response.status === 409 || Boolean(data.question) !== Boolean(saved.current.question)) {
          setConflict(data);
          setMessage("已保存的进度或题目有变化。请核对后继续。");
        } else {
          setMessage(payload.error?.message ?? "当前题目无法执行此操作。");
        }
      } else {
        setMessage(payload.error?.message ?? "暂时无法保存，请重试。");
      }
    } catch {
      setMessage("未收到保存确认。可以重试这次操作。");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function command(action: Command) {
    if (!ready || busy || pending || conflict) return;
    const { session } = saved.current;
    const position = session.position;
    const body = action.action === "next" || action.action === "resume"
      ? { ...action, position }
      : { ...action, position, draftMd: input.current };
    void send({ key: crypto.randomUUID(), version: session.rowVersion, body });
  }

  function useSavedProgress() {
    if (!conflict) return;
    if (storageBlocked && draft !== (review.item?.draftMd ?? "") &&
        !window.confirm("浏览器无法暂存这份草稿。载入已保存进度会替换当前输入，继续吗？")) return;
    retryRef.current = null;
    setPending(null);
    adopt(conflict);
    setConflict(null);
    setMessage("");
  }

  function recover(entry: CachedReviewDraft) {
    if (draft !== (review.item?.draftMd ?? "") && !window.confirm("用这份本地草稿替换编辑框中的内容？")) return;
    changeDraft(entry.text);
    setCached((current) => current.filter(({ key }) => key !== entry.key));
    setDraftOpen(true);
  }

  const { session, item, question, summary, intervals } = review;
  const locked = !ready || busy || Boolean(pending) || Boolean(conflict);
  const dirty = draft !== (item?.draftMd ?? "");
  const assisted = item?.usedHint || item?.answerMode === "peek";
  const outcome = item?.outcome;
  const editable = session.status === "active" && !outcome && Boolean(question);

  return <div className="review-round">
    <nav className="crumbs" aria-label="当前位置"><AppLink href="/review"><ArrowLeft size={15} aria-hidden="true" /> 复习中心</AppLink></nav>
    <header className="review-round-head">
      <div>
        <p className="field-hint">{summary ? `共 ${session.total} 题` : `第 ${session.position}/${session.total} 题${question ? ` · ${question.courseName}` : ""}`}</p>
        <h1 ref={heading} tabIndex={-1}>{summary ? (session.status === "ended" ? "本轮已结束" : "本轮复习完成")
          : question ? <QuestionTitle text={question.title} /> : "此题已不可用"}</h1>
      </div>
      {!summary && <div className="review-round-management">
        {session.status === "active" && <button className="text-link" disabled={locked} type="button" onClick={() => command({ action: "pause" })}>暂停</button>}
        <button className="text-link" disabled={locked} type="button" onClick={() => setConfirmEnd(!confirmEnd)} aria-expanded={confirmEnd}>结束本轮</button>
      </div>}
    </header>
    {confirmEnd && !summary && <div className="review-feedback">
      <p>结束后会保留本轮已提交的自评和跳过记录。</p>
      <div className="actions">
        <button className="button" disabled={locked} type="button" onClick={() => command({ action: "end" })}>确认结束</button>
        <button className="text-link" type="button" onClick={() => setConfirmEnd(false)}>取消</button>
      </div>
    </div>}
    {summary ? <section className="review-panel">
      <dl className="review-totals">
        <div><dt>完成</dt><dd>{summary.completed}</dd></div>
        <div><dt>跳过</dt><dd>{summary.skipped}</dd></div>
        <div><dt>待巩固</dt><dd>{summary.practice}</dd></div>
        {summary.pending > 0 && <div><dt>未完成</dt><dd>{summary.pending}</dd></div>}
      </dl>
      {summary.unavailable > 0 && <p className="field-hint">跳过的题目中有 {summary.unavailable} 道已不可用。</p>}
      <div className="actions">
        {summary.practice > 0 && <StartReviewButton input={{ kind: "practice", sessionId: session.id }} label="重练本轮待巩固题" />}
        <AppLink className="button" href="/review">回到复习中心</AppLink>
      </div>
    </section> : item && <>
      {session.status === "paused" && <div className="review-feedback">
        <p>已暂停，当前进度已保存。</p>
        <div className="actions">
          <button className="button primary" disabled={locked} type="button" onClick={() => command({ action: "resume" })}>继续本轮</button>
          <AppLink className="text-link" href="/review">回到复习中心</AppLink>
        </div>
      </div>}
      {question ? <section className="review-panel question-statement" aria-label="题目正文">
        <Markdown source={question.statementMd} />
        <OriginalQuestionImages ids={question.originalAssetIds} />
      </section> : <p className="empty">此题已删除或所在课程不可用。可以跳过并继续本轮。</p>}
      {question && <section className="review-work" aria-labelledby="review-work-title">
        <h2 id="review-work-title">{item.answerMode ? "核对答案" : "再练"}</h2>
        {!item.answerMode && !outcome && <p className="field-hint">可以先在纸上完成，也可以在这里记下解题过程。</p>}
        {editable && <fieldset disabled={locked} className="review-draft">
          <legend className="sr-only">本题草稿</legend>
          <button className="text-link" type="button" aria-expanded={draftOpen} aria-controls="review-draft" onClick={() => setDraftOpen(!draftOpen)}>{draftOpen ? "收起解题过程" : "写解题过程"}</button>
          <div id="review-draft" hidden={!draftOpen}>
            {draftOpen && <MarkdownEditor key={session.position} label="解题过程（可选）" name="draftMd" value={draft} onChange={changeDraft} rows={5} />}
          </div>
          {dirty && <p className="field-hint" role="status">{storageBlocked ? "草稿暂存在此页，离开前请保存。" : "草稿暂存在此浏览器。"}</p>}
        </fieldset>}
        {!editable && item.draftMd && <details className="create-panel review-disclosure">
          <summary>本次解题过程</summary>
          <div className="panel-content"><Markdown source={item.draftMd} /></div>
        </details>}
        {item.usedHint && <details className="create-panel review-disclosure" open={hintOpen} onToggle={(event) => setHintOpen(event.currentTarget.open)}>
          <summary>提示 · 已查看</summary>
          <div className="panel-content">{question.hintMd?.trim() ? <Markdown source={question.hintMd} /> : <p className="empty">这道题的提示已移除。</p>}</div>
        </details>}
        {item.answerMode && <div className="review-answer">
          <h3>{item.answerMode === "peek" ? "参考答案 · 提前查看" : "参考答案"}</h3>
          <SolutionReader key={item.questionId} scope={`review-${item.questionId}`} review answerMd={question.answerMd ?? ""}
            document={question.solutionDocument} steps={question.solutionSteps ?? []} topics={question.solutionTopics ?? []} layers={question.solutionLayers} />
        </div>}
      </section>}
      {cached.length > 0 && editable && <details className="review-feedback">
        <summary>恢复浏览器中的草稿</summary>
        {cached.map((entry, index) => <div className="review-cache" key={entry.key}>
          <p className="field-hint">{entry.version === session.rowVersion ? "同一版本" : "来自较早版本"} · {index + 1}</p>
          <pre>{entry.text || "（空白草稿）"}</pre>
          <div className="actions">
            <button className="button" type="button" disabled={locked} onClick={() => recover(entry)}>载入这份草稿</button>
            <button className="text-link" type="button" onClick={() => {
              clearReviewDraft(entry.key);
              setCached(cached.filter(({ key }) => key !== entry.key));
            }}>清除此副本</button>
          </div>
        </div>)}
      </details>}
      {(message || busy || conflict) && <div className="review-feedback" role={pending || conflict ? "alert" : "status"}>
        <p>{busy ? "正在保存…" : message}</p>
        <div className="actions">
          {pending && !busy && <button className="button primary" type="button" onClick={() => void send(pending)}>重试保存</button>}
          {pending && !busy && <button className="text-link" type="button" onClick={() => {
            retryRef.current = null;
            setPending(null);
            setMessage("");
          }}>取消重试</button>}
          {conflict && <button className="button" type="button" onClick={useSavedProgress}>载入已保存进度</button>}
        </div>
      </div>}
      {session.status === "active" && <section className="review-actions" aria-label="复习操作">
        {outcome ? <>
          <p className="save-status" tabIndex={-1} ref={assessmentResult}><Check size={16} aria-hidden="true" />
            已记录 · {outcome === "skipped" || outcome === "unavailable" ? "跳过" : assessmentLabels[outcome]}
            {item.nextReviewOn && <> · 下次复习 <time dateTime={item.nextReviewOn}>{item.nextReviewOn}</time></>}
          </p>
          <div className="actions">
            <button className="button primary" disabled={locked} type="button" onClick={() => command({ action: "next" })}>
              {session.position === session.total ? "查看本轮结果" : "下一题"}<ArrowRight size={16} aria-hidden="true" />
            </button>
            {question && <AppLink className="text-link" href={`/questions/${item.questionId}#learning-state`}>调整复习安排</AppLink>}
          </div>
        </> : <>
          {question && item.answerMode ? <>
            <h3>本题自评</h3>
            <div className="actions review-assessment-options">
              {reviewAssessment.options.map((choice) => <button key={choice} type="button" className="button"
                disabled={locked || (choice === "independent" && Boolean(assisted))}
                onClick={() => command({
                  action: "assess", outcome: choice, nextReviewOn: overrideDate || undefined,
                  learningStateVersion: item.learningStateVersion ?? undefined,
                })}>
                {assessmentLabels[choice]} {!overrideDate && <small>{intervals[choice]} 天后</small>}
              </button>)}
            </div>
            <details className="review-schedule-options">
              <summary>指定下次复习日期</summary>
              <label>下次复习日期<input type="date" value={overrideDate} disabled={locked}
                onChange={(event) => setOverrideDate(event.target.value)} /></label>
              {item.nextReviewOn && <p className="field-hint">当前安排 <time dateTime={item.nextReviewOn}>{item.nextReviewOn}</time></p>}
              <p className="field-hint">留空时按自评结果安排。</p>
            </details>
          </> : question && <div className="actions">
            <button className="button primary" disabled={locked} type="button" onClick={() => command({ action: "answer", mode: "check" })}>做完了，核对答案</button>
            {question.hasHint && !item.usedHint && <button className="button" disabled={locked} type="button" onClick={() => command({ action: "hint" })}>看提示</button>}
            <button className="text-link" disabled={locked} type="button" onClick={() => command({ action: "answer", mode: "peek" })}>先看答案</button>
          </div>}
          <div className="actions review-secondary-actions">
            {dirty && question && <button className="text-link" type="button" disabled={locked} onClick={() => command({ action: "draft" })}>保存草稿</button>}
            <button className="text-link" type="button" disabled={locked} onClick={() => command({ action: "skip" })}>跳过此题</button>
          </div>
        </>}
      </section>}
    </>}
    {summary && message && <p className="save-error" role="alert">{message}</p>}
  </div>;
}

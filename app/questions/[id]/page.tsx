import { AppLink } from "@/components/app-link";
import { TechnicalDetails } from "@/components/technical-details";
import { QuestionTitle } from "@/components/question-title";
import { ArrowLeft, Ellipsis, History, NotebookPen, Pencil, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { DeleteQuestion, LearningStateEditor } from "@/components/learning-forms";
import { Markdown } from "@/components/markdown";
import { AttemptNotes, difficultyLabels, OriginalQuestionImages } from "@/components/question-reading";
import { QuestionStudyControls } from "@/components/question-study-controls";
import { SolutionReader } from "@/components/solution-reader";
import { QuestionSolutionSources } from "@/components/solution-evidence";
import { StartReviewButton } from "@/components/review-entry";
import { committedLearningNotes, questionConversationSources } from "@/db/queries/imports";
import { featuredSource } from "@/db/queries/question-topics";
import { idSchema } from "@/domain/catalog";
import { contextImportNamespace, contextSourceLabel } from "@/domain/context-reference";
import { displayDateTime, outcomeLabels } from "@/lib/learning-display";
import { exampleReturnHref } from "@/lib/example-return";
import { OwnerPage } from "@/lib/owner-page";
import { courseReadingHref, isReadingAnchor } from "@/lib/reading-anchor";
import { solutionAnnotationPositions } from "@/lib/solution-anchors";
import { getCourse, getTopic } from "@/services/catalog";
import { getQuestion, listAttempts } from "@/services/questions";
import { reviewIntervals } from "@/services/review-policy";

export const dynamic = "force-dynamic";
export const metadata = { title: "题目详情" };

const sourceLabel = (namespace: string) => namespace === contextImportNamespace ? contextSourceLabel : "历史档案证据";

async function findExampleReturn(topicId: string, questionId: string, courseId: string | undefined, visit: string | undefined) {
  const featured = await featuredSource(topicId, questionId);
  if (featured && (!courseId || featured.courseId === courseId)) {
    return { href: exampleReturnHref(courseId ?? null, topicId, questionId, visit), label: "返回原例题", featured: true };
  }
  const topic = featured ?? await getTopic(topicId);
  if (topic) {
    const currentCourse = courseId ? topic.courseId : null;
    return { href: exampleReturnHref(currentCourse, topicId, featured ? questionId : undefined), label: "返回笔记", featured: Boolean(featured) };
  }
  if (courseId && await getCourse(courseId)) {
    return { href: courseReadingHref(courseId), label: "继续阅读课程", featured: false };
  }
}

export default async function QuestionPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const path = `/questions/${id}`;
  const { fromTopic, fromReading, fromExample, fromCourse, readingVisit } = await searchParams;
  const topic = idSchema.safeParse(fromTopic);
  const courseContext = idSchema.optional().safeParse(fromCourse);
  const token = idSchema.safeParse(readingVisit);
  const exampleContext = topic.success && courseContext.success && fromExample === id
    ? { topicId: topic.data, courseId: courseContext.data, visit: token.success ? token.data : undefined } : null;
  const readingHref = fromExample === undefined && topic.success && isReadingAnchor(fromReading)
    ? `/topics/${fromTopic}#${encodeURIComponent(fromReading)}` : undefined;
  const origin = new URLSearchParams();
  if (exampleContext) {
    origin.set("fromTopic", exampleContext.topicId);
    origin.set("fromExample", id);
    if (exampleContext.courseId) origin.set("fromCourse", exampleContext.courseId);
    if (exampleContext.visit) origin.set("readingVisit", exampleContext.visit);
  }
  return <OwnerPage returnTo={exampleContext ? `${path}?${origin}` : path}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const question = await getQuestion(id, ownerId);
      if (!question) notFound();
      const [course, attempts, importedNotes, conversationSources, exampleReturn] = await Promise.all([
        question.primaryCourseId ? getCourse(question.primaryCourseId) : null, listAttempts(id, ownerId), committedLearningNotes(id, ownerId),
        questionConversationSources(id, ownerId),
        exampleContext && findExampleReturn(exampleContext.topicId, id, exampleContext.courseId, exampleContext.visit),
      ]);
      const mainConversationSource = conversationSources.find(({ primary }) => primary);
      const additionalSources = conversationSources.filter((source) => source !== mainConversationSource);
      const positions = question.solutionDocument ? solutionAnnotationPositions(question.solutionDocument.bodyMd) : new Map();
      const displayedAnnotations = question.solutionDocument?.annotations.filter(({ id }) => positions.has(id)) ?? [];
      const displayedQuestions = new Map(displayedAnnotations.map(({ id, learnerQuestionsMd }) => [id, new Set(learnerQuestionsMd)]));
      const sourceQuestions = importedNotes.map((note) => ({
        ...note,
        learner_questions: note.learner_questions.filter(({ annotation_id, question_md, evidence }) => {
          if (!question_md.trim() || annotation_id && displayedQuestions.get(annotation_id)?.has(question_md)) return false;
          return !evidence.length || !question.solutionLayers?.mainThreads.some(({ anchorId, turns }) =>
            anchorId === annotation_id && turns.some(({ learner }) => evidence.every((proof) => learner.evidence?.some((entry) =>
              entry.sourceKey === proof.source_key && entry.locator === proof.locator
                && entry.quote === proof.quote && entry.speaker === proof.speaker,
            ))));
        }),
        evidenced_mistakes: note.evidenced_mistakes.filter(({ description_md }) => description_md.trim()),
      })).filter(({ learner_questions, evidenced_mistakes }) => learner_questions.length || evidenced_mistakes.length);
      const oldSupplements = sourceQuestions.flatMap(({ id, learner_questions, evidenced_mistakes }) => [
        ...learner_questions.map((entry) => <div className="solution-note-title" key={`${id}/question/${entry.id}`}>
          <Markdown source={entry.question_md} />
        </div>),
        ...evidenced_mistakes.map((entry) => <div key={`${id}/mistake/${entry.id}`}>
          <h3>{entry.kind === "observed_learner_error" ? "已核对的作答错误" : "资料中的易错点"}</h3>
          <Markdown source={entry.description_md} />
        </div>),
      ]);
      return <>
        <nav className="crumbs study-crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink>{course && <><span aria-hidden="true">/</span><AppLink href={`/courses/${course.id}`}>{course.name}</AppLink></>}
          {(exampleReturn || readingHref) && <><span aria-hidden="true">/</span><AppLink href={exampleReturn ? exampleReturn.href : readingHref!}
            scroll={exampleReturn?.featured ? false : undefined}>
            {exampleReturn ? exampleReturn.label : "返回阅读位置"}
          </AppLink></>}
        </nav>
        <div className="question-study-layout">
          <QuestionStudyControls />
          <article className="reading question-paper">
            <header className="reading-head">
              <h1><QuestionTitle text={question.title} /></h1>
              <details className="question-metadata" suppressHydrationWarning>
                <summary className="button small" aria-label="题目管理" title="题目管理"><Ellipsis size={20} aria-hidden="true" /></summary>
                <div className="question-metadata-content">
                  <h2>题目管理</h2>
                  <div className="actions">
                    <AppLink className="text-link" href={path + "/edit"}><Pencil size={16} aria-hidden="true" />编辑题目与归属</AppLink>
                    <AppLink className="text-link" href={path + "/revisions"}><History size={16} aria-hidden="true" />版本记录</AppLink>
                    <a className="text-link" href={`/api/v1${path}?view=solution-markdown`} download>下载 Markdown</a>
                  </div>
                  {(question.sourceTitle || question.sourceLocator || question.sourceDate || additionalSources.length > 0) && <section className="question-source">
                    <h3>来源</h3>
                    {(question.sourceTitle || question.sourceLocator || question.sourceDate) && <p>{[question.sourceTitle, question.sourceLocator].filter(Boolean).join(" · ")}
                      {question.sourceDate && <>{(question.sourceTitle || question.sourceLocator) && " · "}<time dateTime={question.sourceDate}>{question.sourceDate}</time></>}
                      {mainConversationSource && <span className="field-hint"> · {sourceLabel(mainConversationSource.namespace)}</span>}
                    </p>}
                    {additionalSources.length > 0 && <ul>{additionalSources.map(({ id, title, namespace }) =>
                      <li key={id}>{title}<span className="field-hint"> · {sourceLabel(namespace)}</span></li>)}</ul>}
                  </section>}
                  <QuestionSolutionSources layers={question.solutionLayers} importedNotes={importedNotes} />
                  {question.difficulty !== null && <p className="field-hint">难度 {difficultyLabels[question.difficulty]} · {question.difficulty}/5</p>}
                  <p className="version">更新于 <time dateTime={question.updatedAt}>{displayDateTime(question.updatedAt)}</time></p>
                  <TechnicalDetails fields={[["题目编号", id]]} />
                  <div className="actions">
                    <AppLink className="text-link" href={`/manage/learning/${id}`}>清理学习记录</AppLink>
                    <AppLink className="text-link" href={`/manage/question/${id}`}>永久删除题目</AppLink>
                  </div>
                  <DeleteQuestion id={id} rowVersion={question.rowVersion} />
                </div>
              </details>
            </header>
            <section className="question-statement" id="statement" tabIndex={-1} aria-label="题目正文">
              {question.statementMd.trim() && <Markdown source={question.statementMd} />}
              <OriginalQuestionImages ids={question.originalAssetIds} />
            </section>
            <section className="question-answer" aria-labelledby="answer-heading">
              <h2 id="answer-heading" tabIndex={-1}>完整解答</h2>
              <SolutionReader scope={`question-${id}`} document={question.solutionDocument} steps={question.solutionSteps} topics={question.topics}
                answerMd={question.finalAnswerMd} layers={question.solutionLayers} techniquesMd={question.keyTechniquesMd}
                extraSupplements={oldSupplements.length > 0 ? oldSupplements : undefined} />
            </section>
            <footer className="question-footer">
              {question.topics.length > 0 && <nav className="question-topics" aria-label="关联知识点">
                <h3>关联知识点</h3>
                <ul>{question.topics.map((topic) => (
                  <li key={topic.id}><AppLink className="text-link" href={`/topics/${topic.id}`}>{topic.title}<small>{topic.courseName}{topic.chapterTitle && ` / ${topic.chapterTitle}`}</small></AppLink></li>
                ))}</ul>
              </nav>}
              <div className="question-footer-actions">
                {(exampleReturn || readingHref) && <nav aria-label="继续阅读">
                  <AppLink className="text-link question-reading-return" href={exampleReturn ? exampleReturn.href : readingHref!}
                    scroll={exampleReturn?.featured ? false : undefined}>
                    <ArrowLeft size={18} aria-hidden="true" />
                    {exampleReturn?.label === "继续阅读课程" ? exampleReturn.label : "继续阅读原笔记"}
                  </AppLink>
                </nav>}
                <details className="question-learning-record" suppressHydrationWarning>
                  <summary className="button small"><NotebookPen size={16} aria-hidden="true" />学习记录</summary>
                  <div className="question-learning-content">
                    <details className="question-footer-item" suppressHydrationWarning>
                      <summary>练习与自评</summary>
                      <div className="question-footer-content" id="learning-state" tabIndex={-1}>
                        <div className="actions">
                          <StartReviewButton input={{ kind: "question", questionId: id }} label="练习本题" />
                          <AppLink className="text-link" href="/review">复习中心</AppLink>
                        </div>
                        {question.learningState && <LearningStateEditor questionId={id} state={question.learningState} intervals={reviewIntervals()} />}
                      </div>
                    </details>
                      {attempts?.length ? <details className="question-footer-item" suppressHydrationWarning>
                        <summary>历史作答 · {attempts.length}</summary>
                        <div className="question-footer-content" id="attempts" tabIndex={-1}>
                          <AppLink className="text-link" href={path + "/attempts/new"}><Plus size={17} aria-hidden="true" />记录作答</AppLink>
                          <ol className="attempt-list">
                            {attempts.map((attempt, index) => (
                              <li key={attempt.id}>
                                <details className="create-panel attempt-card" suppressHydrationWarning>
                                  <summary>
                                    <span className="attempt-date"><span className="attempt-number">第 {attempts.length - index} 次记录</span>{attempt.attemptedAt
                                      ? <time dateTime={attempt.attemptedAt}>{displayDateTime(attempt.attemptedAt)}</time>
                                      : typeof attempt.extraJson.attemptedOn === "string"
                                        ? <time dateTime={attempt.extraJson.attemptedOn}>{attempt.extraJson.attemptedOn}</time>
                                        : <>记录于 <time dateTime={attempt.createdAt}>{displayDateTime(attempt.createdAt)}</time></>}</span>
                                    <span className="study-badge attempt-outcome" data-outcome={attempt.outcome}>{outcomeLabels[attempt.outcome]}</span>
                                  </summary>
                                  <div className="panel-content" id={`attempt-${attempt.id}`} tabIndex={-1}>
                                    <AttemptNotes attempt={attempt} />
                                    <div className="actions">
                                      <AppLink className="text-link" href={`/attempts/${attempt.id}/edit`}><Pencil size={16} aria-hidden="true" />补充思路与错误分析</AppLink>
                                      <AppLink className="text-link" href={`/attempts/${attempt.id}/revisions`}><History size={16} aria-hidden="true" />作答版本</AppLink>
                                      <AppLink className="text-link" href={`/manage/attempt/${attempt.id}`}>删除这条作答</AppLink>
                                    </div>
                                  </div>
                                </details>
                              </li>
                            ))}
                          </ol>
                        </div>
                      </details> : <AppLink className="text-link question-footer-record" id="attempts" href={path + "/attempts/new"}>
                        <Plus size={16} aria-hidden="true" />记录作答
                      </AppLink>}
                  </div>
                </details>
              </div>
            </footer>
          </article>
        </div>
      </>;
    }}
  </OwnerPage>;
}

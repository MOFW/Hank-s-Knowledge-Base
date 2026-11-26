import { notFound } from "next/navigation";
import { Fragment, Suspense } from "react";
import { ArrowRight, Pencil, Plus } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { CourseDirectory, CourseReturnLink, ReadingRail } from "@/components/course-directory";
import { TopicNeighbors } from "@/components/directory";
import { FeaturedExample } from "@/components/featured-example";
import { ImportEvidenceQuotes } from "@/components/import-evidence-quotes";
import { Markdown } from "@/components/markdown";
import { NoteSupplement } from "@/components/note-supplement";
import { prepareReading, ReadingOutline } from "@/components/markdown-reading";
import { ReadingPosition } from "@/components/reading-position";
import { QuestionLinks } from "@/components/question-reading";
import { committedTopicNotes, relatedImportedTopics } from "@/db/queries/imports";
import { featuredExamplesQuery } from "@/db/queries/question-topics";
import { idSchema } from "@/domain/catalog";
import { contextImportNamespace, contextSourceLabel } from "@/domain/context-reference";
import { historyImportNamespace } from "@/domain/history-reference";
import { chapterHref, chapterTrail, groupDirectory, readingDirectory } from "@/lib/directory";
import { OwnerPage } from "@/lib/owner-page";
import { courseReadingHref } from "@/lib/reading-anchor";
import { getDirectory, getTopic } from "@/services/catalog";
import { listTopicQuestions } from "@/services/questions";

export const dynamic = "force-dynamic";

type Directory = NonNullable<Awaited<ReturnType<typeof getDirectory>>>;
type Topic = NonNullable<Awaited<ReturnType<typeof getTopic>>>;

async function TopicBreadcrumbs({ directory, topic }: { directory: Promise<Directory | null>; topic: Topic }) {
  const data = await directory;
  const courseId = data?.course.id;
  const trail = chapterTrail(data?.chapters ?? [], topic.chapterId);
  return <nav className="crumbs textbook-crumbs" aria-label="当前位置">
      <AppLink href="/courses">课程</AppLink><span aria-hidden="true">/</span>
      {courseId ? <CourseReturnLink courseId={courseId}>{data.course.name}</CourseReturnLink> : <AppLink href="/topics/unassigned">未归类</AppLink>}
      {courseId && trail.map((chapter) => <Fragment key={chapter.id}>
        <span aria-hidden="true">/</span><AppLink href={chapterHref(courseId, chapter.id)}>{chapter.title}</AppLink>
      </Fragment>)}
      {courseId && trail.length === 0 && <><span aria-hidden="true">/</span><AppLink href={chapterHref(courseId, null)}>课程根目录</AppLink></>}
  </nav>;
}

async function TopicDirectory({ directory, topic }: { directory: Promise<Directory | null>; topic: Topic }) {
  const data = await directory;
  if (!data) return null;
  return <CourseDirectory courseId={data.course.id} currentTopic={topic.id} currentChapter={topic.chapterId}
    entries={readingDirectory(data.chapters, data.topics)} />;
}

async function Neighbors({ directory, topicId }: { directory: Promise<Directory | null>; topicId: string }) {
  const data = await directory;
  if (!data) return null;
  const { orderedTopics } = groupDirectory(data.chapters, data.topics);
  const index = orderedTopics.findIndex(({ id }) => id === topicId);
  return index < 0 ? null : <TopicNeighbors previous={orderedTopics[index - 1]} next={orderedTopics[index + 1]} />;
}

async function Practice({ id, ownerId }: { id: string; ownerId: string }) {
  const questions = await listTopicQuestions(id, ownerId, { limit: 6 });
  return <details className="reading-tool">
    <summary>关联题目</summary>
    <div className="reading-tool-body">
      <QuestionLinks items={questions?.items ?? []} empty="还没有关联题目。" />
      {questions?.nextCursor && <AppLink href={`/questions?topicId=${id}`} className="text-link">查看全部关联题目<ArrowRight size={16} aria-hidden="true" /></AppLink>}
      <AppLink className="text-link" href={`/questions/new?topicId=${id}`}><Plus size={16} aria-hidden="true" />添加题目</AppLink>
    </div>
  </details>;
}

async function Sources({ id, ownerId }: { id: string; ownerId: string }) {
  const [importedNotes, relatedTopics] = await Promise.all([committedTopicNotes(id, ownerId), relatedImportedTopics(id)]);
  return <>
    {relatedTopics.length > 0 && <details className="reading-tool">
      <summary>相关知识点</summary>
      <ul className="topic-tags reading-tool-body">{relatedTopics.map(({ id, title }) => <li key={id}><AppLink href={`/topics/${id}`}>{title}</AppLink></li>)}</ul>
    </details>}
    {importedNotes.length > 0 && <details className="reading-tool imported-topic-notes" suppressHydrationWarning>
      <summary>导入的学习记录、补充与来源</summary>
      <div className="reading-tool-body">{importedNotes.map((note) => <section key={note.id}>
        {note.learner_questions.map(({ id, question_md, evidence }) => <div key={`question-${id}`}>
          <h3>学习者疑问</h3><Markdown source={question_md} /><ImportEvidenceQuotes evidence={evidence} sources={note.sources} />
        </div>)}
        {note.evidenced_mistakes.map(({ id, description_md, evidence }) => <div key={`mistake-${id}`}>
          <h3>学习者错误</h3><Markdown source={description_md} /><ImportEvidenceQuotes evidence={evidence} sources={note.sources} />
        </div>)}
        {note.aiNotesMd && <div><h3>AI 补充解释</h3><Markdown source={note.aiNotesMd} /></div>}
        {note.sources.length > 0 && <p className="field-hint">来源 · {note.sources.map(({ title }) => title).join("、")}
          {note.namespace === contextImportNamespace && <> · {contextSourceLabel}</>}
          {note.namespace === historyImportNamespace && <> · 历史档案批次</>}
        </p>}
        {note.batchId && <AppLink className="text-link" href={`/imports/${note.batchId}#item-${note.id}`}>查看导入证据</AppLink>}
      </section>)}</div>
    </details>}
  </>;
}

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/topics/${id}`}>
    {async (ownerId, timezone) => {
      if (!idSchema.safeParse(id).success) notFound();
      const topic = await getTopic(id);
      if (!topic) notFound();
      const directory = topic.courseId ? getDirectory(topic.courseId) : Promise.resolve(null);
      const examples = await featuredExamplesQuery(id, ownerId).all();
      const reading = prepareReading(topic.bodyMd, undefined, { examples, render: (example) =>
        <FeaturedExample key={example.questionId} example={example} ownerId={ownerId} courseId={null} topicId={id} />,
      });
      return <div className="directory-layout textbook-layout">
          <Suspense fallback={<div className="crumbs textbook-crumbs" aria-hidden="true">课程</div>}>
            <TopicBreadcrumbs directory={directory} topic={topic} />
          </Suspense>
          <ReadingRail key={id} readingSource={{ ownerId, courseId: null, topicId: id }} directory={topic.courseId ? <Suspense fallback={<p className="directory-feedback" role="status">正在加载课程目录…</p>}>
            <TopicDirectory directory={directory} topic={topic} />
          </Suspense> : undefined}>
            <ReadingOutline headings={reading.headings} />
            <div className="reading-note-actions">
              {topic.courseId && <AppLink className="text-link" href={courseReadingHref(topic.courseId, id)}>在课程中阅读</AppLink>}
              <AppLink className="text-link" href={`/topics/${id}/edit`}><Pencil size={14} aria-hidden="true" />编辑笔记</AppLink>
              <details className="reading-tool reading-management">
                <summary>笔记管理</summary>
                <div className="reading-tool-body">
                  <AppLink className="text-link" href={`/topics/${id}/revisions`}>历史版本</AppLink>
                  <AppLink className="text-link" href={`/manage/topic/${id}`}>删除笔记</AppLink>
                </div>
              </details>
              <Suspense fallback={null}><Practice id={id} ownerId={ownerId} /></Suspense>
              <Suspense fallback={null}><Sources id={id} ownerId={ownerId} /></Suspense>
            </div>
          </ReadingRail>
          <div className="directory-main">
            <article className="reading textbook-reading" id="topic-start" tabIndex={-1}>
              <header className="reading-head">
                <h1>{topic.title}</h1>
                {topic.summaryMd && <div className="reading-summary"><Markdown source={topic.summaryMd} /></div>}
                <div className="note-meta">
                  <p className="version">更新于 <time dateTime={topic.updatedAt}>{new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, dateStyle: "medium" }).format(new Date(topic.updatedAt))}</time></p>
                  <ReadingPosition ownerId={ownerId} topicId={id} headingIds={reading.headings.map((heading) => heading.id)} />
                </div>
              </header>
              {!topic.bodyMd.trim() && <p className="empty">这篇笔记还没有正文。</p>}
              {reading.body}
              <NoteSupplement source={topic.supplementMd} />
            </article>
            <Suspense fallback={null}><Neighbors directory={directory} topicId={id} /></Suspense>
          </div>
        </div>;
    }}
  </OwnerPage>;
}

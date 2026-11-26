import { notFound } from "next/navigation";
import { ArrowRight, ChevronRight, Ellipsis, Plus } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { CourseDirectory } from "@/components/course-directory";
import { CourseFilters } from "@/components/course-filters";
import { CourseReadingLink } from "@/components/course-reading-link";
import { Markdown } from "@/components/markdown";
import { QuestionLinks } from "@/components/question-reading";
import { idSchema } from "@/domain/catalog";
import { chapterAnchor, chapterOptions, groupDirectory, matchesDirectory, readingDirectory } from "@/lib/directory";
import { OwnerPage } from "@/lib/owner-page";
import { courseReadingHref } from "@/lib/reading-anchor";
import { getDirectory } from "@/services/catalog";
import { listQuestions } from "@/services/questions";

export const dynamic = "force-dynamic";

const views = [
  { id: "notes", title: "全部笔记" },
  { id: "chapters", title: "课程章节" },
  { id: "questions", title: "相关题目" },
];

async function CourseQuestions({ id, ownerId }: { id: string; ownerId: string }) {
  const { items } = await listQuestions(ownerId, { courseId: id, scope: "related", limit: 12 });
  return <section aria-label="相关题目">
    <QuestionLinks items={items} empty="这门课程还没有关联题目。" />
    <AppLink className="text-link" href={`/questions?courseId=${id}&scope=related`}>在题库查看与练习<ArrowRight size={16} aria-hidden="true" /></AppLink>
  </section>;
}

export default async function CoursePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapterId?: string | string[]; q?: string | string[]; view?: string }>;
}) {
  const { id } = await params;
  const filters = await searchParams;
  const path = `/courses/${id}`;
  return <OwnerPage returnTo={path}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const directory = await getDirectory(id);
      if (!directory) notFound();
      const chapters = chapterOptions(directory.chapters);
      const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
      const selected = typeof filters.chapterId === "string" ? byId.get(filters.chapterId) : undefined;
      const rootOnly = filters.chapterId === "root";
      const query = typeof filters.q === "string" ? filters.q.trim().slice(0, 120) : "";
      const included = new Set<string>();
      if (selected) {
        included.add(selected.id);
        for (const chapter of chapters) {
          if (chapter.parentId && included.has(chapter.parentId)) included.add(chapter.id);
        }
      }
      const { orderedTopics } = groupDirectory(directory.chapters, directory.topics);
      const notes = orderedTopics.filter((topic) => {
        if (selected && (!topic.chapterId || !included.has(topic.chapterId))) return false;
        if (rootOnly && topic.chapterId) return false;
        return matchesDirectory(query, topic.title);
      });
      const active = selected?.id ?? (rootOnly ? "root" : "");
      const noteEditor = `${path}/topics/new${selected ? `?chapterId=${selected.id}` : ""}`;
      const view = views.find((item) => item.id === filters.view)?.id ?? "notes";
      return <div className="catalog-page course-home">
        <nav className="crumbs" aria-label="当前位置"><AppLink href="/courses">课程</AppLink><span aria-hidden="true">/</span><span>{directory.course.name}</span></nav>
        <header className="course-home-heading">
          <div>
            <h1>{directory.course.name}</h1>
            {directory.course.descriptionMd.trim() && <Markdown source={directory.course.descriptionMd} />}
            <p className="field-hint course-count">{chapters.length} 章 · {orderedTopics.length} 篇笔记</p>
          </div>
          <CourseReadingLink ownerId={ownerId} courseId={id} notes={orderedTopics.map(({ id, chapterId }) => ({ id, chapterId }))} />
        </header>
        <div className="course-home-tabs">
          <nav aria-label="课程视图">
            {views.map(({ id, title }) => <AppLink key={id} href={id === "notes" ? path : `${path}?view=${id}`}
              aria-current={id === view ? "page" : undefined}>{title}</AppLink>)}
          </nav>
          <details className="course-actions-menu">
            <summary className="reading-rail-icon" aria-label="课程更多操作" title="课程更多操作"><Ellipsis size={18} aria-hidden="true" /></summary>
            <AppLink href={`${path}/organize`}>课程与章节管理</AppLink>
          </details>
        </div>
        {view === "notes" && <section className="course-notes" aria-label="全部笔记">
          <div className="course-note-controls">
            <CourseFilters key={JSON.stringify([id, query, active])} courseId={id} chapters={chapters} query={query} chapterId={active} />
            <AppLink className="text-link" href={noteEditor}><Plus size={17} aria-hidden="true" />添加笔记</AppLink>
          </div>
          <div id={chapterAnchor(selected?.id ?? null)} className="course-note-results">
            {selected && <div className="course-chapter-heading"><h2>{selected.title}</h2>
              <Markdown source={directory.chapters.find((chapter) => chapter.id === selected.id)?.descriptionMd ?? ""} />
            </div>}
            {notes.length ? <ul className="course-note-list">{notes.map((note) => <li key={note.id}>
              <AppLink href={courseReadingHref(id, note.id)}>
                <span>{note.chapterId ? byId.get(note.chapterId)?.label ?? "未分章" : "未分章"}</span>
                <strong>{note.title}</strong><ChevronRight size={17} aria-hidden="true" />
              </AppLink>
              {note.summaryMd.trim() && <Markdown source={note.summaryMd} />}
            </li>)}</ul> : <p className="empty">{query || active ? "这个范围内没有匹配的笔记。" : "这门课程还没有笔记。"}</p>}
          </div>
        </section>}
        {view === "chapters" && <section className="course-chapters-view" aria-label="课程章节">
          <CourseDirectory courseId={id} entries={readingDirectory(directory.chapters, directory.topics)} />
        </section>}
        {view === "questions" && <CourseQuestions id={id} ownerId={ownerId} />}
      </div>;
    }}
  </OwnerPage>;
}

"use client";

import { memo, useMemo, useRef } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { readingDirectory, type DirectoryEntry } from "@/lib/directory";
import { chapterReadingId, courseReadingHref, scopedId } from "@/lib/reading-anchor";
import type { ReadingBody, ReadingChapter, ReadingNote } from "@/lib/reading-window";
import { AppLink } from "./app-link";
import { CourseDirectory, CourseReturnLink, ReadingRail } from "./course-directory";
import { FeaturedExample } from "./featured-example";
import { prepareReading } from "./markdown-reading";
import { NoteSupplement } from "./note-supplement";
import { useCourseStream } from "./use-course-stream";

const pageTitle = "课程阅读";

const Note = memo(function Note({ note, headings, first, courseId, ownerId }: {
  note: ReadingBody; headings?: DirectoryEntry[]; first: boolean; courseId: string; ownerId: string;
}) {
  const root = headings?.[0]?.depth === 0 ? headings[0] : undefined;
  const subchapters = root ? headings?.slice(1) : headings;
  return <section className="continuous-section" data-reading-note={note.id}>
    {root && <h2 className="continuous-chapter" id={chapterReadingId(root.id)} tabIndex={-1}>{root.title}</h2>}
    {!!subchapters?.length && <h2 className="continuous-subchapters">{subchapters.map(({ id, title }, index) => <span key={id}>
      {index > 0 && <span aria-hidden="true"> / </span>}<span id={chapterReadingId(id)} tabIndex={-1}>{title}</span>
    </span>)}</h2>}
    <article id={scopedId(note.id, "topic-start")} className="continuous-note" tabIndex={-1}>
      {first ? <h1>{note.title}</h1> : <h2>{note.title}</h2>}
      {!note.bodyMd.trim() && <p className="empty">这篇笔记还没有正文。</p>}
      {prepareReading(note.bodyMd, note.id, { examples: note.examples, render: (example) =>
        <FeaturedExample key={example.questionId} example={example} ownerId={ownerId} courseId={courseId} topicId={note.id} />,
      }).body}
      <NoteSupplement source={note.supplementMd} />
    </article>
  </section>;
});

export function CourseReader({ courseId, ownerId, name, chapters, notes, initial }: {
  courseId: string; ownerId: string; name: string; chapters: ReadingChapter[]; notes: ReadingNote[]; initial: ReadingBody;
}) {
  const stream = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const { view, controller } = useCourseStream(courseId, ownerId, notes, initial, { stream, before, after });
  const directory = useMemo(() => {
    const entries = readingDirectory(chapters, notes);
    const boundaries = new Map<string, DirectoryEntry[]>();
    const paths = new Map<string, string>();
    for (const entry of entries) {
      if (!entry.topicId) continue;
      if (entry.kind === "topic") { paths.set(entry.id, entry.path); continue; }
      const list = boundaries.get(entry.topicId) ?? [];
      list.push(entry);
      boundaries.set(entry.topicId, list);
    }
    return { entries, boundaries, paths };
  }, [chapters, notes]);
  const currentIndex = notes.findIndex(({ id }) => id === view.activeId);
  const current = notes[currentIndex] ?? initial;
  function shortcut(note: ReadingNote, direction: "prev" | "next") {
    const previous = direction === "prev";
    return <AppLink href={courseReadingHref(courseId, note.id)} rel={direction} title={note.title} onNavigate={(event) => {
      if (!controller.current) return;
      event.preventDefault();
      controller.current.jump(note.id);
    }}>
      {previous && <ChevronLeft size={16} aria-hidden="true" />}{previous ? "上一篇" : "下一篇"}{!previous && <ChevronRight size={16} aria-hidden="true" />}
    </AppLink>;
  }

  return <div className="continuous-layout">
    <nav className="continuous-masthead" aria-label="课程阅读位置">
      <CourseReturnLink courseId={courseId}><BookOpen size={18} aria-hidden="true" />{name}</CourseReturnLink>
      <span>{pageTitle}</span>
    </nav>
    <ReadingRail continuous readingSource={{ ownerId, courseId }} directory={<CourseDirectory courseId={courseId} currentTopic={current.id} currentChapter={current.chapterId}
      entries={directory.entries} jump={(id, chapterId) => {
        if (!controller.current) return false;
        controller.current.jump(id, chapterId);
        return true;
      }} />} />
    <div className="continuous-stream" ref={stream} onClickCapture={(event) => controller.current?.anchorClick(event)}>
      <div ref={before} className="continuous-edge">
        {view.edges.before && <button className="button" onClick={() => controller.current?.retry("before")}>
          {view.edges.before.stale ? "重新载入课程" : "重试加载前文"}
        </button>}
      </div>
      {view.bodies.map((note, index) => <Note key={note.id} note={note} first={index === 0} headings={directory.boundaries.get(note.id)}
        courseId={courseId} ownerId={ownerId} />)}
      <div ref={after} className="continuous-edge">
        {view.edges.after && <button className="button" onClick={() => controller.current?.retry("after")}>
          {view.edges.after.stale ? "重新载入课程" : "重试加载后文"}
        </button>}
      </div>
    </div>
    <footer className="continuous-footer">
      <div className="continuous-footer-inner">
        <div>{notes[currentIndex - 1] && shortcut(notes[currentIndex - 1], "prev")}</div>
        <div className="continuous-status">
          {view.loading ? <span role="status">正在定位…</span> : view.jumpFailed
            ? <button className="text-link" onClick={() => controller.current?.retry()}>{view.jumpFailed.stale ? "重新载入课程" : "笔记暂时无法打开，重试"}</button>
            : <span title={directory.paths.get(current.id) + " / " + current.title} data-current-note={current.id} data-current-chapter={current.chapterId}>{current.title}</span>}
          <details key={current.id} className="continuous-tools">
            <summary className="reading-rail-icon" aria-label="当前笔记操作" title="当前笔记操作"><Ellipsis size={17} aria-hidden="true" /></summary>
            <div>
              <AppLink href={`/topics/${current.id}`}>单篇笔记与来源</AppLink>
              <AppLink href={`/topics/${current.id}/edit`}>编辑笔记</AppLink>
              <AppLink href={`/questions?topicId=${current.id}`}>关联题目</AppLink>
            </div>
          </details>
        </div>
        <div>{notes[currentIndex + 1] && shortcut(notes[currentIndex + 1], "next")}</div>
      </div>
    </footer>
  </div>;
}

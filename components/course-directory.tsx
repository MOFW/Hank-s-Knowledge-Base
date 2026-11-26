"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ListTree, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { matchesDirectory, type DirectoryEntry } from "@/lib/directory";
import { browserNavigation } from "@/lib/browser-history";
import { courseReadingHref } from "@/lib/reading-anchor";
import { readExampleVisit, type ExampleSource } from "@/lib/example-return";
import { AppLink } from "./app-link";

export function ReadingRail({ directory, children, continuous = false, readingSource }: {
  directory?: ReactNode; children?: ReactNode; continuous?: boolean;
  readingSource?: Pick<ExampleSource, "ownerId" | "courseId"> & { topicId?: string };
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [state, setState] = useState<"initial" | "open" | "closed">("initial");
  const open = state === "open";
  const ownerId = readingSource?.ownerId;
  const courseId = readingSource?.courseId ?? null;
  const topicId = readingSource?.topicId;
  const hasDirectory = Boolean(directory);

  useLayoutEffect(() => {
    if (!ownerId || !hasDirectory) return;
    const frame = requestAnimationFrame(() => {
      if (readExampleVisit(ownerId, courseId, topicId)?.directoryOpen) setState("open");
    });
    return () => cancelAnimationFrame(frame);
  }, [ownerId, courseId, topicId, hasDirectory]);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    locateCurrent(panel.current.querySelector(".browse-list"));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      setState("closed");
      trigger.current?.focus({ preventScroll: true });
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) {
        setState("closed");
      }
    }
    window.addEventListener("keydown", escape);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  function close() {
    setState("closed");
    trigger.current?.focus({ preventScroll: true });
  }

  return <aside className={continuous ? "reading-rail continuous-rail" : "reading-rail"} aria-label={continuous ? "课程导航" : "笔记工具"}>
    {directory && <div className="reading-directory">
      <button type="button" ref={trigger} className="reading-rail-icon" title="课程目录" aria-label="课程目录"
        aria-expanded={open} aria-controls={id} onMouseDown={continuous ? (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
        } : undefined} onClick={open ? close : () => setState("open")}>
        {open ? <X size={19} aria-hidden="true" /> : <ListTree size={19} aria-hidden="true" />}
      </button>
      <section className="course-directory-panel" id={id} aria-labelledby={id + "-title"} hidden={!open} ref={panel}>
        <header className="course-directory-head"><h2 id={id + "-title"}>课程目录</h2>
          <button type="button" className="reading-rail-icon" aria-label="关闭课程目录" onClick={close}><X size={17} aria-hidden="true" /></button>
        </header>
        {state !== "initial" && <div onClick={(event) => {
          if ((!continuous || matchMedia("(max-width: 69.999rem)").matches) &&
              event.defaultPrevented && event.target instanceof Element && event.target.closest("a[data-app-link]")) close();
        }}>{directory}</div>}
      </section>
    </div>}
    {children && <div className="reading-rail-actions" inert={open}>{children}</div>}
  </aside>;
}

function locateCurrent(list: HTMLElement | null, onlyIfOutside = false) {
  const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!list || !current || !list.getClientRects().length) return;
  const row = current.getBoundingClientRect();
  const frame = list.getBoundingClientRect();
  if (onlyIfOutside && row.top >= frame.top && row.bottom <= frame.bottom) return;
  list.scrollTop += row.top - frame.top - (list.clientHeight - current.offsetHeight) / 2;
}

function Highlight({ label, query }: { label: string; query: string }) {
  const term = query.trim().toLocaleLowerCase().split(/\s+/).find((part) => part && label.toLocaleLowerCase().includes(part));
  if (!term) return label;
  const index = label.toLocaleLowerCase().indexOf(term);
  return <>{label.slice(0, index)}<mark>{label.slice(index, index + term.length)}</mark>{label.slice(index + term.length)}</>;
}

export function CourseDirectory({ courseId, currentTopic, currentChapter, entries, jump, searchable = true }: {
  courseId: string;
  currentTopic?: string;
  currentChapter?: string | null;
  entries: DirectoryEntry[];
  jump?: (topicId: string, chapterId?: string) => boolean;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const searching = Boolean(query.trim());
  const visible = searching ? entries.filter(({ title, path }) => matchesDirectory(query, title, path)) : entries;

  useLayoutEffect(() => {
    if (!searching) locateCurrent(list.current, true);
  }, [currentTopic, searching]);

  function row({ kind, id, title, path, topicId }: DirectoryEntry, children?: ReactNode) {
    const chapterId = kind === "chapter" ? id : undefined;
    const current = kind === "topic" && id === currentTopic ? "page" : chapterId && chapterId === currentChapter ? "location" : undefined;
    const className = "browse-row contents-" + kind;
    const label = <span><Highlight label={title} query={query} />{searching && path && <small>{path}</small>}</span>;
    return <li key={kind + id}>
      {topicId ? <AppLink className={className} href={courseReadingHref(courseId, topicId, undefined, chapterId)}
        aria-current={current}
        onNavigate={jump ? (event) => {
          if (!jump(topicId, chapterId)) return;
          event.preventDefault();
          setFeedback("");
        } : undefined}>{label}</AppLink>
        : <button className={className} type="button" onClick={() => setFeedback(`「${title}」暂无笔记。`)}>{label}</button>}
      {children}
    </li>;
  }

  let index = 0;
  function tree(depth: number) {
    const group: ReactNode[] = [];
    while (visible[index]?.depth === depth) {
      const entry = visible[index++];
      group.push(row(entry, visible[index]?.depth === depth + 1 ? tree(depth + 1) : undefined));
    }
    return <ul className={depth === 0 ? "directory-contents" : undefined} style={{ "--depth": depth } as CSSProperties}>{group}</ul>;
  }

  return <>
    {searchable && <label className="course-directory-search">
      <Search size={16} aria-hidden="true" />
      <input aria-label="查找章节或笔记" type="search" value={query} placeholder="查找章节或笔记" onChange={(event) => {
        setQuery(event.target.value);
        setFeedback("");
        if (list.current) list.current.scrollTop = 0;
      }} />
    </label>}
    {feedback && <p className="directory-feedback" role="status">{feedback}</p>}
    <div className="browse-list" ref={list}>
      {visible.length ? <nav aria-label="完整课程目录">
        {searching ? <ul className="directory-contents">{visible.map((entry) => row(entry))}</ul> : tree(0)}
      </nav> : <p className="empty">{searching ? "没有匹配的章节或笔记。" : "还没有章节或笔记。"}</p>}
    </div>
  </>;
}

export function CourseReturnLink({ courseId, children }: { courseId: string; children: ReactNode }) {
  const router = useRouter();
  const href = `/courses/${courseId}`;
  return <AppLink href={href} onNavigate={(event) => {
    const navigation = browserNavigation();
    const prior = navigation?.entries()[navigation.currentEntry.index - 1]?.url;
    if (!prior || new URL(prior).pathname !== href) return;
    event.preventDefault();
    router.back();
  }}>{children}</AppLink>;
}

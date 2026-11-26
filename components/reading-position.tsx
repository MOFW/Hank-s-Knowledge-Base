"use client";

import { AppLink } from "@/components/app-link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bookmark } from "lucide-react";
import { exampleAnchor, isReadingAnchor } from "@/lib/reading-anchor";
import { courseReadingHref } from "@/lib/reading-anchor";
import { clearLatestCourse, readLatestCourse } from "@/lib/course-reading-position";
import { consumeExampleVisit, readExampleVisit } from "@/lib/example-return";

type Position = { topicId: string; anchor: string };
const positionChanged = "hkb:reading-position";
const keyFor = (ownerId: string) => `hkb-reading-position:${ownerId}`;
const readingLine = () => Math.min(180, innerHeight / 3);
function read(ownerId: string) {
  try { return localStorage.getItem(keyFor(ownerId)); } catch { return null; }
}
function parse(raw: string | null): Position | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value.topicId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.topicId)) return null;
    if (!isReadingAnchor(value.anchor)) return null;
    return { topicId: value.topicId, anchor: value.anchor };
  } catch { return null; }
}
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("pageshow", onChange);
  window.addEventListener(positionChanged, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pageshow", onChange);
    window.removeEventListener(positionChanged, onChange);
  };
}
function usePosition(ownerId: string) {
  return parse(useSyncExternalStore(subscribe, () => read(ownerId), () => null));
}
function write(ownerId: string, value: Position) {
  try {
    clearLatestCourse(ownerId);
    const key = keyFor(ownerId);
    const serialized = JSON.stringify(value);
    if (localStorage.getItem(key) === serialized) return;
    localStorage.setItem(key, serialized);
    window.dispatchEvent(new Event(positionChanged));
  } catch { /* Reading works without storage. */ }
}

type ResumeTopic = { id: string; title: string; courseName?: string };
type RecentTopic = ResumeTopic & { updatedAt: string; dateLabel: string };

export function HomeReading({ ownerId, topics, courses }: {
  ownerId: string; topics: RecentTopic[]; courses: { id: string; name: string }[];
}) {
  const position = usePosition(ownerId);
  const latestCourse = useSyncExternalStore(subscribe, () => readLatestCourse(ownerId), () => null);
  const savedId = position?.topicId;
  const recent = topics.find((topic) => topic.id === savedId);
  const [older, setOlder] = useState<ResumeTopic>();
  useEffect(() => {
    if (!savedId || recent) return;
    const controller = new AbortController();
    void fetch(`/api/v1/topics/${savedId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const { data } = await response.json() as { data?: { title?: string; courseId?: string } };
        if (typeof data?.title === "string" && !controller.signal.aborted) {
          setOlder({ id: savedId, title: data.title, courseName: courses.find((course) => course.id === data.courseId)?.name });
        }
      })
      .catch(() => { /* The recent-note link remains available. */ });
    return () => controller.abort();
  }, [savedId, recent, courses]);
  const bookmarked = recent ?? (older?.id === savedId ? older : undefined);
  const topic = bookmarked ?? topics[0];
  const hash = bookmarked && position ? `#${encodeURIComponent(position.anchor)}` : "";
  const continuous = bookmarked && latestCourse && courses.some(({ id }) => id === latestCourse)
    ? courseReadingHref(latestCourse, bookmarked.id) + "&resume=1" : undefined;
  const otherNotes = topics.filter(({ id }) => id !== topic?.id).slice(0, 4);
  return <>
    <section className="home-reading" aria-label="阅读">
      <AppLink className="home-reading-link" href={continuous ?? (topic ? `/topics/${topic.id}${hash}` : "/courses")} prefetch={!continuous}>
        <span className="home-reading-label"><Bookmark size={15} aria-hidden="true" />{bookmarked ? "继续阅读" : topic ? "最近更新" : "阅读笔记"}</span>
        <span className="home-reading-title">{topic?.title ?? "浏览课程"}</span>
        {topic?.courseName && <span className="home-reading-course">{topic.courseName}</span>}
        <ArrowRight className="home-reading-arrow" size={23} aria-hidden="true" />
      </AppLink>
    </section>
    {otherNotes.length > 0 && <section className="section workbench-notes">
      <div className="section-head"><h2>最近更新的笔记</h2></div>
      <ul className="activity-list">{otherNotes.map((note) => <li key={note.id}>
        <AppLink href={`/topics/${note.id}`}>
          <span className="activity-body"><strong>{note.title}</strong><small>{note.courseName}</small></span>
          <time dateTime={note.updatedAt}>{note.dateLabel}</time><ArrowRight size={16} aria-hidden="true" />
        </AppLink>
      </li>)}</ul>
    </section>}
  </>;
}

export function ReadingPosition({ ownerId, topicId, headingIds }: { ownerId: string; topicId: string; headingIds: string[] }) {
  const router = useRouter();
  const position = usePosition(ownerId);
  useEffect(() => {
    const previous = parse(read(ownerId));
    const article = document.getElementById("topic-start");
    if (previous?.topicId !== topicId) write(ownerId, { topicId, anchor: "topic-start" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let moved = false;
    function reveal(hash: string) {
      let id: string;
      try { id = decodeURIComponent(hash.replace(/^#/, "")); } catch { return; }
      if (!isReadingAnchor(id) || id === "topic-start") return;
      const [section, paragraph] = id.split("~");
      const target = (paragraph ? document.getElementById(paragraph) : null) ??
        document.getElementById(section) ?? document.getElementById("topic-start");
      if (!target || (target.id !== "topic-start" && !target.closest(".textbook-prose"))) return;
      const opened: HTMLDetailsElement[] = [];
      for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open) {
          parent.setAttribute("data-instant-disclosure", "");
          parent.open = true;
          opened.push(parent);
        }
      }
      write(ownerId, { topicId, anchor: target.id === paragraph ? id : target.id });
      requestAnimationFrame(() => {
        if (target.id === paragraph) {
          window.scrollBy({ top: target.getBoundingClientRect().top - readingLine() + 2, behavior: "instant" });
        } else {
          target.scrollIntoView();
        }
        target.focus({ preventScroll: true });
        opened.forEach((details) => details.removeAttribute("data-instant-disclosure"));
      });
    }
    function onHashChange() { reveal(location.hash); }
    function onAnchorClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("data-featured-solution")) return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin) return;
      if (/^\/questions\/[0-9a-f-]{36}$/i.test(destination.pathname) && link.closest(".textbook-prose, .related-practice")) {
        save(link.closest<HTMLElement>(".textbook-prose p[id]"));
        const current = parse(read(ownerId));
        if (current?.topicId !== topicId) return;
        destination.searchParams.set("fromTopic", topicId);
        destination.searchParams.set("fromReading", current.anchor);
        if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && (!link.target || link.target === "_self") && !link.hasAttribute("download")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          history.replaceState(history.state, "", `#${encodeURIComponent(current.anchor)}`);
          moved = false;
          router.push(destination.pathname + destination.search + destination.hash);
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (link.target && link.target !== "_self")) return;
      if (destination.pathname !== location.pathname || destination.search !== location.search) {
        save();
        return;
      }
      reveal(destination.hash);
    }
    function save(linkParagraph?: HTMLElement | null) {
      if ((!moved && !linkParagraph) || !article?.isConnected) return;
      const line = readingLine();
      const blocks = article.querySelectorAll<HTMLElement>(".textbook-prose :is(h1,h2,h3,h4,h5,h6,p,[data-featured-example])[id]");
      let section = "topic-start";
      let anchor: string | undefined;
      for (const block of blocks) {
        if (block.closest("details:not([open])") || !block.getClientRects().length) continue;
        const rect = block.getBoundingClientRect();
        if (block !== linkParagraph && rect.top > line && !linkParagraph) break;
        if (block.hasAttribute("data-featured-example")) {
          anchor = block.id;
        } else if (block.id.startsWith("note-")) {
          section = block.id;
          anchor = section;
        } else if (block.id.startsWith("para-")) {
          anchor = `${section}~${block.id}`;
        }
        if (block === linkParagraph) break;
      }
      if (anchor && isReadingAnchor(anchor)) write(ownerId, { topicId, anchor });
    }
    function savePosition() { save(); }
    function onScroll() { moved = true; clearTimeout(timer); timer = setTimeout(savePosition, 300); }
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) onHashChange(); }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", savePosition);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onAnchorClick, true);
    const visit = readExampleVisit(ownerId, null, topicId);
    if (visit) {
      const target = document.getElementById(exampleAnchor(visit.questionId)) ?? article;
      requestAnimationFrame(() => {
        for (const details of article?.querySelectorAll<HTMLDetailsElement>("details[id]") ?? []) {
          details.open = visit.opened.includes(details.id);
        }
        if (target?.hasAttribute("data-featured-example")) {
          window.scrollBy({ top: target.getBoundingClientRect().top - visit.top, behavior: "instant" });
          target.focus({ preventScroll: true });
        } else target?.scrollIntoView();
        consumeExampleVisit();
      });
    } else onHashChange();
    return () => {
      clearTimeout(timer); save(); window.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", savePosition);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("hashchange", onHashChange); document.removeEventListener("click", onAnchorClick, true);
    };
  }, [ownerId, router, topicId]);
  if (position?.topicId !== topicId || (position.anchor === "topic-start") ||
      (!position.anchor.startsWith("topic-start~") && !position.anchor.startsWith("example-") &&
        !headingIds.includes(position.anchor.split("~")[0]))) return null;
  return <a className="text-link reading-position-link" href={`#${encodeURIComponent(position.anchor)}`}><Bookmark size={15} aria-hidden="true" />上次位置</a>;
}

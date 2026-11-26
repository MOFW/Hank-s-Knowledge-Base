"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import {
  legacyReadingKey, readBrowserValue, readCourseLocation, saveCourseLocation, type ReadingLocation,
} from "@/lib/course-reading-position";
import { courseReadingHref, exampleAnchor, isReadingAnchor, scopedId } from "@/lib/reading-anchor";
import { consumeExampleVisit, readExampleVisit } from "@/lib/example-return";
import {
  findReadingBlock, locationFromHash, readingLine, readingTarget, type ReadingBody, type ReadingNote,
} from "@/lib/reading-window";

type Direction = "before" | "after";
type LocationState = { ownerId: string; courseId: string; position: ReadingLocation; opened?: string[] };
type Failure = { stale: boolean };
type View = { bodies: ReadingBody[]; activeId: string; loading?: boolean; jumpFailed?: Failure; edges: Partial<Record<Direction, Failure>> };
type Elements = {
  stream: RefObject<HTMLDivElement | null>;
  before: RefObject<HTMLDivElement | null>;
  after: RefObject<HTMLDivElement | null>;
};
type Landing = { location: ReadingLocation; startOfPage?: boolean; focus?: boolean; openedIds?: string[]; exampleVisit?: boolean };
type Controller = {
  jump: (topicId: string, chapterId?: string) => void;
  anchorClick: (event: MouseEvent) => void;
  afterRender: () => void;
  retry: (edge?: Direction) => void;
};
const mountedLimit = 7;
const cacheLimit = 12;
const historyKey = "hkbCourseReading";
const startOffset = () => readingLine() - 84;

function legacyPosition(ownerId: string, indices: Map<string, number>): ReadingLocation | null {
  try {
    const value = JSON.parse(readBrowserValue(legacyReadingKey(ownerId)) ?? "null");
    if (indices.has(value?.topicId) && isReadingAnchor(value?.anchor)) return { ...value, offset: 0 };
  } catch { /* A malformed old bookmark is treated as absent. */ }
  return null;
}

export function useCourseStream(
  courseId: string, ownerId: string, notes: ReadingNote[], initial: ReadingBody, { stream, before, after }: Elements,
) {
  const router = useRouter();
  const [view, setView] = useState<View>({ bodies: [initial], activeId: initial.id, edges: {} });
  const controller = useRef<Controller | null>(null);

  useLayoutEffect(() => { controller.current?.afterRender(); }, [view]);

  useEffect(() => {
    const stage = stream.current;
    if (!stage) return;
    const path = courseReadingHref(courseId);
    const indices = new Map(notes.map(({ id }, index) => [id, index]));
    const startIndex = indices.get(initial.id) ?? 0;
    const cache = new Map<string, ReadingBody>();
    const opened = new Set<string>();
    const requests = new Map<string, { abort: AbortController; promise: Promise<ReadingBody> }>();
    let active = startIndex;
    let start = startIndex;
    let bodies = [initial];
    let edges: View["edges"] = {};
    let jumpFailed: Failure | undefined;
    let jumpLoading = false;
    let lastJump: Landing | undefined;
    let landing: Landing | undefined;
    let pin: { element: HTMLElement; top: number } | undefined;
    let changing = false;
    let frame = 0;
    let timer = 0;
    let generation = 0;
    let disposed = false;
    let initialized = false;

    function publish() {
      if (!disposed) setView({ bodies, activeId: notes[active].id, loading: jumpLoading, jumpFailed, edges });
    }

    const bodyKey = (note: ReadingNote) => `${note.id}:${note.rowVersion}`;
    function cacheBody(key: string, body: ReadingBody) {
      cache.delete(key);
      cache.set(key, body);
      if (cache.size > cacheLimit) cache.delete(cache.keys().next().value!);
    }
    cacheBody(bodyKey(initial), initial);

    function requestBody(note: ReadingNote) {
      const key = bodyKey(note);
      const cached = cache.get(key);
      if (cached) {
        cacheBody(key, cached);
        return Promise.resolve(cached);
      }
      const pending = requests.get(key);
      if (pending) return pending.promise;
      const abort = new AbortController();
      const promise = fetch(`/api/v1/courses/${courseId}/read/${note.id}`, { signal: abort.signal })
        .then(async (response) => {
          if (!response.ok) throw { stale: response.status === 404 };
          const { data } = await response.json() as { data: ReadingBody };
          if (!abort.signal.aborted) cacheBody(key, data);
          return data;
        })
        .finally(() => {
          if (requests.get(key)?.abort === abort) requests.delete(key);
        });
      requests.set(key, { abort, promise });
      return promise;
    }

    function currentSection(index: number) {
      return stage!.querySelector<HTMLElement>(`[data-reading-note="${notes[index].id}"]`);
    }

    function activeSection() {
      const line = readingLine();
      let section: HTMLElement | undefined;
      for (const candidate of stage!.querySelectorAll<HTMLElement>("[data-reading-note]")) {
        if (section && candidate.getBoundingClientRect().top > line) break;
        section = candidate;
      }
      return section;
    }

    function capture(section = activeSection()): ReadingLocation | undefined {
      if (!section) return;
      const { element, anchor } = findReadingBlock(section);
      const topicId = section.dataset.readingNote!;
      return { topicId, anchor, offset: readingLine() - element.getBoundingClientRect().top, chapterId: notes[indices.get(topicId)!].chapterId };
    }

    function stateWith(position: ReadingLocation) {
      return { ...history.state, [historyKey]: { courseId, ownerId, position, opened: [...opened] } satisfies LocationState };
    }

    function save() {
      clearTimeout(timer);
      if (!initialized || changing || jumpLoading || !stage!.getClientRects().length || location.pathname !== path) return;
      const position = capture();
      if (!position) return;
      saveCourseLocation(ownerId, courseId, position);
      const previous = history.state?.[historyKey] as LocationState | undefined;
      const old = previous?.position;
      if (old?.topicId !== position.topicId || old.anchor !== position.anchor || old.offset !== position.offset ||
          previous?.opened?.length !== opened.size || previous.opened.some((id) => !opened.has(id))) {
        history.replaceState(stateWith(position), "");
      }
    }

    function scrollToLanding({ location: target, startOfPage, focus }: Landing) {
      const section = currentSection(indices.get(target.topicId)!);
      if (!section) return;
      const element = readingTarget(target, section);
      for (let node = element.parentElement; node && node !== section; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement && !node.open) {
          const detail = node;
          node.setAttribute("data-instant-disclosure", "");
          node.open = true;
          opened.add(node.id);
          requestAnimationFrame(() => detail.removeAttribute("data-instant-disclosure"));
        }
      }
      if (startOfPage) window.scrollTo({ top: 0, behavior: "instant" });
      else {
        const exact = scopedId(target.topicId, target.anchor.split("~").at(-1)!);
        const usedFallback = !target.entryAnchor && element.id !== exact;
        const offset = usedFallback ? startOffset() : target.offset;
        window.scrollBy({ top: element.getBoundingClientRect().top - readingLine() + offset, behavior: "instant" });
      }
      if (focus) {
        if (!element.matches("a, button, [tabindex]")) element.tabIndex = -1;
        element.focus({ preventScroll: true });
      }
    }

    function afterRender() {
      if (!changing) return;
      const restoredIds = landing?.openedIds;
      if (restoredIds) {
        opened.clear();
        restoredIds.forEach((id) => opened.add(id));
      }
      for (const detail of stage!.querySelectorAll<HTMLDetailsElement>("details[id]")) {
        if (!restoredIds && !opened.has(detail.id)) continue;
        const next = opened.has(detail.id);
        if (detail.open === next) continue;
        detail.setAttribute("data-instant-disclosure", "");
        detail.open = next;
        requestAnimationFrame(() => detail.removeAttribute("data-instant-disclosure"));
      }
      if (landing) {
        scrollToLanding(landing);
        if (landing.exampleVisit) {
          history.replaceState(stateWith(landing.location), "");
          consumeExampleVisit();
        }
      }
      else if (pin?.element.isConnected) {
        window.scrollBy({ top: pin.element.getBoundingClientRect().top - pin.top, behavior: "instant" });
      }
      changing = false;
      landing = undefined;
      pin = undefined;
      schedule();
    }

    function reveal(target: Landing, { replaceWindow = false } = {}) {
      const index = indices.get(target.location.topicId);
      if (index === undefined) return;
      lastJump = target;
      generation += 1;
      const intent = generation;
      jumpFailed = undefined;
      const resident = bodies[index - start];
      for (const [key, { abort }] of requests) {
        if (key !== bodyKey(notes[index])) { abort.abort(); requests.delete(key); }
      }
      edges = {};
      function open(body: ReadingBody) {
        if (disposed || intent !== generation) return;
        jumpLoading = false;
        active = index!;
        if (!resident || replaceWindow) { start = index!; bodies = [body]; }
        landing = target;
        changing = true;
        publish();
      }
      if (resident) { open(resident); return; }
      jumpLoading = true;
      publish();
      void requestBody(notes[index]).then(open).catch((failure: Failure) => {
        if (disposed || intent !== generation) return;
        jumpLoading = false;
        jumpFailed = failure;
        publish();
      });
    }

    function extend(direction: Direction, bounds: { top: number; bottom: number }) {
      const prepend = direction === "before";
      const index = prepend ? start - 1 : start + bodies.length;
      const note = notes[index];
      if (!note || edges[direction]) return;
      const distance = prepend ? -bounds.top : bounds.bottom - innerHeight;
      if (distance > innerHeight * 1.1) return;
      const intent = generation;
      void requestBody(note).then((body) => {
        if (disposed || intent !== generation || jumpLoading || jumpFailed || index !== (prepend ? start - 1 : start + bodies.length)) return;
        const space = prepend ? -before.current!.getBoundingClientRect().top : after.current!.getBoundingClientRect().top - innerHeight;
        if (space > innerHeight * (prepend ? .42 : .72)) return;
        if (bodies.length >= mountedLimit && (prepend ? start + bodies.length - 1 - active : active - start) < 3) return;
        if (!pin && !landing) {
          const section = activeSection();
          if (section) {
            const { element } = findReadingBlock(section);
            pin = { element, top: element.getBoundingClientRect().top };
          }
        }
        if (prepend) {
          start = index;
          bodies = [body, ...bodies].slice(0, mountedLimit);
        } else {
          bodies = [...bodies, body];
          if (bodies.length > mountedLimit) { bodies = bodies.slice(1); start += 1; }
        }
        changing = true;
        publish();
      }).catch((failure: Failure) => {
        if (disposed || intent !== generation) return;
        edges = { ...edges, [direction]: { stale: failure.stale === true } };
        publish();
      });
    }

    function tick() {
      frame = 0;
      if (!initialized || changing || jumpLoading || jumpFailed || !stage!.getClientRects().length || location.pathname !== path) return;
      const section = activeSection();
      const index = section ? indices.get(section.dataset.readingNote!) : undefined;
      if (index !== undefined && index !== active) { active = index; publish(); }
      const bounds = { top: before.current!.getBoundingClientRect().top, bottom: after.current!.getBoundingClientRect().top };
      extend("before", bounds);
      extend("after", bounds);
      clearTimeout(timer);
      timer = window.setTimeout(save, 160);
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(tick);
    }

    function targetFromUrl(): Landing {
      const params = new URLSearchParams(location.search);
      const explicit = params.get("topicId");
      const currentState = history.state?.[historyKey] as LocationState | undefined;
      const sameCourse = currentState?.courseId === courseId && currentState.ownerId === ownerId;
      const fromHistory = sameCourse ? currentState.position : null;
      const visit = readExampleVisit(ownerId, courseId);
      if (visit && indices.has(visit.topicId)) {
        return { location: { topicId: visit.topicId, anchor: exampleAnchor(visit.questionId),
          offset: readingLine() - visit.top, chapterId: notes[indices.get(visit.topicId)!].chapterId },
        openedIds: visit.opened, focus: true, exampleVisit: true };
      }
      const bookmark = readCourseLocation(ownerId, courseId) ?? legacyPosition(ownerId, indices);
      const saved = fromHistory ?? (!explicit || params.has("resume") ? bookmark : null);
      if (saved && indices.has(saved.topicId)) return { location: saved, openedIds: sameCourse ? currentState.opened : undefined };
      const fallback = saved?.chapterId !== undefined ? notes.find((note) => note.chapterId === saved.chapterId) : undefined;
      const topicId = fallback?.id ?? (explicit && indices.has(explicit) ? explicit : notes[0].id);
      return {
        location: { topicId, ...locationFromHash(topicId, location.hash), offset: startOffset() },
        startOfPage: !location.hash && topicId === notes[0].id,
      };
    }

    function jump(topicId: string, chapterId?: string, anchor?: string) {
      if (jumpFailed) jumpFailed = undefined;
      save();
      const href = courseReadingHref(courseId, topicId, anchor, chapterId);
      const target = {
        topicId, ...locationFromHash(topicId, new URL(href, location.origin).hash),
        offset: startOffset(),
        chapterId: notes[indices.get(topicId)!].chapterId,
      };
      if (href !== location.pathname + location.search + location.hash) {
        history.pushState(stateWith(target), "", href);
      } else {
        history.replaceState(stateWith(target), "", href);
      }
      reveal({ location: target, focus: true });
    }

    function anchorClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const article = link.closest<HTMLElement>("[data-reading-note]");
      const topicId = article?.dataset.readingNote;
      const href = link.getAttribute("href") ?? "";
      if (topicId && href.startsWith("#") && href.length > 1) {
        const parsed = locationFromHash(topicId, href);
        event.preventDefault();
        jump(topicId, undefined, parsed.entryAnchor ?? parsed.anchor);
      }
    }

    function traverse() {
      if (location.pathname === path) reveal(targetFromUrl());
    }

    function disclosureChanged(event: Event) {
      const node = event.target;
      if (!(node instanceof HTMLDetailsElement) || !node.id) return;
      if (node.open) opened.add(node.id);
      else opened.delete(node.id);
      schedule();
    }

    controller.current = {
      afterRender, jump, anchorClick,
      retry(edge) {
        if (edge ? edges[edge]?.stale : jumpFailed?.stale) {
          router.refresh();
        } else if (edge) {
          const next = { ...edges };
          delete next[edge];
          edges = next;
          publish();
          schedule();
        } else if (lastJump) {
          reveal(lastJump);
        }
      },
    };

    const startFrame = requestAnimationFrame(() => {
      initialized = true;
      reveal(targetFromUrl(), { replaceWindow: true });
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("popstate", traverse);
    window.addEventListener("pagehide", save);
    document.addEventListener("click", save, true);
    stage.addEventListener("toggle", disclosureChanged, true);
    return () => {
      disposed = true;
      controller.current = null;
      cancelAnimationFrame(startFrame);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      for (const { abort } of requests.values()) abort.abort();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("popstate", traverse);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("click", save, true);
      stage.removeEventListener("toggle", disclosureChanged, true);
    };
  }, [courseId, ownerId, notes, initial, stream, before, after, router]);

  return { view, controller };
}

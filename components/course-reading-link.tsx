"use client";

import { useSyncExternalStore } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import { AppLink } from "./app-link";
import { legacyReadingKey, readBrowserValue, readCourseLocation, readingPositionChanged } from "@/lib/course-reading-position";
import { courseReadingHref, isReadingAnchor } from "@/lib/reading-anchor";

function subscribe(change: () => void) {
  const events = ["storage", "pageshow", readingPositionChanged];
  for (const event of events) window.addEventListener(event, change);
  return () => { for (const event of events) window.removeEventListener(event, change); };
}

export function CourseReadingLink({ ownerId, courseId, notes }: {
  ownerId: string; courseId: string; notes: { id: string; chapterId: string | null }[];
}) {
  function savedTopic() {
    const saved = readCourseLocation(ownerId, courseId);
    if (saved) {
      return notes.find(({ id }) => id === saved.topicId)?.id ??
        notes.find(({ chapterId }) => chapterId === saved.chapterId)?.id ?? "";
    }
    try {
      const legacy = JSON.parse(readBrowserValue(legacyReadingKey(ownerId)) ?? "null");
      return isReadingAnchor(legacy?.anchor) ? notes.find(({ id }) => id === legacy.topicId)?.id ?? "" : "";
    } catch { return ""; }
  }

  const saved = useSyncExternalStore(subscribe, savedTopic, () => "");
  if (!notes.length) return null;
  const href = courseReadingHref(courseId, saved || notes[0].id) + (saved ? "&resume=1" : "");
  return <AppLink className="button primary course-start" href={href}>
    <BookOpen size={17} aria-hidden="true" />{saved ? "继续阅读" : "开始阅读"}<ArrowRight size={16} aria-hidden="true" />
  </AppLink>;
}

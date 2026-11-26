import { isReadingAnchor } from "./reading-anchor";

export type ReadingLocation = {
  topicId: string;
  anchor: string;
  offset: number;
  chapterId?: string | null;
  entryAnchor?: string;
};
type SavedLocation = ReadingLocation & { savedAt: number };
export const readingPositionChanged = "hkb:reading-position";
const courseKey = (owner: string, course: string) => `hkb-course-reading:${owner}:${course}`;
export const legacyReadingKey = (owner: string) => `hkb-reading-position:${owner}`;
const latestKey = (owner: string) => `hkb-latest-course-reading:${owner}`;

export function readBrowserValue(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function readCourseLocation(owner: string, course: string): SavedLocation | null {
  try {
    const value = JSON.parse(readBrowserValue(courseKey(owner, course)) ?? "null");
    if (typeof value?.topicId !== "string" || !isReadingAnchor(value.anchor) ||
        !Number.isFinite(value.offset) || !Number.isFinite(value.savedAt)) return null;
    return value;
  } catch { return null; }
}

export function readLatestCourse(owner: string) {
  return readBrowserValue(latestKey(owner));
}

export function saveCourseLocation(owner: string, course: string, location: ReadingLocation) {
  try {
    const { topicId, anchor, chapterId, offset } = location;
    const previous = readCourseLocation(owner, course);
    const legacy = JSON.stringify({ topicId, anchor: isReadingAnchor(anchor) ? anchor : "topic-start" });
    if (previous?.topicId !== topicId || previous.anchor !== anchor || previous.offset !== offset || previous.chapterId !== chapterId) {
      localStorage.setItem(courseKey(owner, course), JSON.stringify({ topicId, anchor, offset, chapterId, savedAt: Date.now() }));
    }
    if (localStorage.getItem(latestKey(owner)) === course && localStorage.getItem(legacyReadingKey(owner)) === legacy) return;
    localStorage.setItem(latestKey(owner), course);
    localStorage.setItem(legacyReadingKey(owner), legacy);
    window.dispatchEvent(new Event(readingPositionChanged));
  } catch { /* The reader can run without storage. */ }
}

export function clearLatestCourse(owner: string) {
  try { localStorage.removeItem(latestKey(owner)); } catch { /* Storage is optional. */ }
}

const anchorPattern = /^(?:topic-start|note-[\p{L}\p{N}\p{M}-]+)(?:~para-[a-z0-9]+-[1-9]\d*)?$/u;
const examplePattern = /^example-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isPlacementAnchor(value: string) {
  return value !== "topic-start" && value.length <= 220 && anchorPattern.test(value);
}

export function isReadingAnchor(value: unknown): value is string {
  return typeof value === "string" && (value === "topic-start" || isPlacementAnchor(value) || examplePattern.test(value));
}

export const exampleAnchor = (questionId: string) => `example-${questionId}`;
export const scopedId = (topicId: string, id: string) => `reading-${topicId}-${id}`;
export const chapterReadingId = (chapterId: string) => `reading-chapter-${chapterId}`;

export function courseReadingHref(courseId: string, topicId?: string, anchor?: string, chapterId?: string) {
  const path = `/courses/${courseId}/read`;
  const hash = chapterId ? chapterReadingId(chapterId) : topicId && anchor ? scopedId(topicId, anchor) : "";
  return (topicId ? `${path}?topicId=${topicId}` : path) + (hash ? `#${encodeURIComponent(hash)}` : "");
}

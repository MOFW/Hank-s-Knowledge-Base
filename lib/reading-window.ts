import type { ReadingLocation } from "./course-reading-position";
import type { FeaturedExample } from "@/domain/question-topic";
import { chapterReadingId, isReadingAnchor, scopedId } from "./reading-anchor";

export type ReadingNote = { id: string; title: string; chapterId: string | null; rowVersion: number };
export type ReadingBody = ReadingNote & { bodyMd: string; supplementMd: string | null; examples: FeaturedExample[] };
export type ReadingChapter = { id: string; title: string; parentId: string | null };

export const readingLine = () => Math.min(156, innerHeight / 3);
const blocks = ".textbook-prose :is(h1,h2,h3,h4,h5,h6,p,[data-featured-example])[id]";

export function findReadingBlock(section: HTMLElement) {
  const topicId = section.dataset.readingNote!;
  const prefix = scopedId(topicId, "");
  let anchor = "topic-start";
  let sectionAnchor = anchor;
  let element = section.querySelector<HTMLElement>(".continuous-note") ?? section;
  for (const block of section.querySelectorAll<HTMLElement>(blocks)) {
    if (block.closest("details:not([open])") || !block.getClientRects().length) continue;
    if (block.getBoundingClientRect().top > readingLine()) break;
    const local = block.id.slice(prefix.length);
    if (block.hasAttribute("data-featured-example")) {
      anchor = local;
    } else if (local.startsWith("note-")) {
      sectionAnchor = local;
      anchor = local;
    } else if (local.startsWith("para-")) {
      anchor = `${sectionAnchor}~${local}`;
    } else {
      continue;
    }
    element = block;
  }
  return { anchor, element };
}

export function readingTarget({ topicId, anchor, entryAnchor }: ReadingLocation, section: HTMLElement) {
  const localId = (id: string) => {
    const node = document.getElementById(id);
    return node && section.contains(node) ? node : null;
  };
  if (entryAnchor) {
    const target = localId(entryAnchor.startsWith("reading-chapter-") ? entryAnchor : scopedId(topicId, entryAnchor));
    if (target) return target;
  }
  const [heading, paragraph] = anchor.split("~");
  return (paragraph ? localId(scopedId(topicId, paragraph)) : null) ??
    localId(scopedId(topicId, heading)) ?? section;
}

export function locationFromHash(topicId: string, hash: string): Pick<ReadingLocation, "anchor" | "entryAnchor"> {
  let token: string;
  try { token = decodeURIComponent(hash.slice(1)); } catch { return { anchor: "topic-start" }; }
  if (token.length > 280) return { anchor: "topic-start" };
  if (token.startsWith(chapterReadingId(""))) return { anchor: "topic-start", entryAnchor: token };
  const scope = scopedId(topicId, "");
  const local = token.startsWith(scope) ? token.slice(scope.length) : token;
  if (isReadingAnchor(local)) return { anchor: local };
  return { anchor: "topic-start", entryAnchor: local || undefined };
}

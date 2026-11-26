import type { Code, Data, Parents, Root } from "mdast";
import type { Extension as FromMarkdownExtension } from "mdast-util-from-markdown";
import type { InlineMath, Math } from "mdast-util-math";
import type { Extension, Tokenizer } from "micromark-util-types";
import type { Node } from "unist";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified, type Processor } from "unified";

const prefix = "[^hkb-";
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

declare module "micromark-util-types" {
  interface TokenTypeMap { hkbSolutionAnchor: "hkbSolutionAnchor" }
}

interface Anchor extends Node { type: "hkbSolutionAnchor"; value: string; data?: Data }

declare module "mdast" {
  interface PhrasingContentMap { hkbSolutionAnchor: Anchor }
  interface RootContentMap { hkbSolutionAnchor: Anchor }
}

const tokenize: Tokenizer = (effects, ok, nok) => {
  let prefixIndex = 0;
  let id = "";
  return start;

  function start(code: number | null) {
    effects.enter("hkbSolutionAnchor");
    return readPrefix(code);
  }

  function readPrefix(code: number | null) {
    if (code !== prefix.charCodeAt(prefixIndex)) return nok(code);
    effects.consume(code);
    return ++prefixIndex === prefix.length ? readId : readPrefix;
  }

  function readId(code: number | null) {
    if (code === 93 && idPattern.test(id)) {
      effects.consume(code);
      effects.exit("hkbSolutionAnchor");
      return ok;
    }
    if (code === null || id.length === 64) return nok(code);
    const char = String.fromCharCode(code);
    if (!/[a-z0-9-]/.test(char)) return nok(code);
    id += char;
    effects.consume(code);
    return readId;
  }
};

const syntax: Extension = { text: { 91: { name: "hkbSolutionAnchor", tokenize } } };
const fromMarkdown: FromMarkdownExtension = {
  enter: {
    hkbSolutionAnchor(token) {
      this.enter({ type: "hkbSolutionAnchor", value: this.sliceSerialize(token) }, token);
    },
  },
  exit: { hkbSolutionAnchor(token) { this.exit(token); } },
};

export function remarkSolutionAnchors(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(fromMarkdown);
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkSolutionAnchors).freeze();

type AnchorLocation = {
  id: string;
  node: Anchor;
  blockIndex: number;
  target: Math | InlineMath | Code | null;
  placementOffset?: number;
  hasTarget: boolean;
  hasStepTarget: boolean;
};

type Content = Parents["children"][number];

function isMarkerParagraph(node: Content | Root | undefined) {
  return node?.type === "paragraph" && node.children.every((child) =>
    child.type === "hkbSolutionAnchor" || (child.type === "text" && !child.value.trim()));
}

function isInlineTarget(node: Content) {
  if (node.type === "text") return /[^\s][ \t]*$/.test(node.value);
  return node.type === "inlineMath" || node.type === "inlineCode" || node.type === "strong" ||
    node.type === "emphasis" || node.type === "delete" || node.type === "link" || node.type === "linkReference";
}

export function solutionAnchorLocations(tree: Root) {
  const locations: AnchorLocation[] = [];
  function visit(parent: Parents, rootIndex?: number, previousBlock?: Content) {
    const markerParagraph = isMarkerParagraph(parent);
    const lineGap = (parent.position?.start.line ?? Infinity) - (previousBlock?.position?.end.line ?? 0);
    const display = markerParagraph && lineGap >= 1 && lineGap <= 2 &&
      (previousBlock?.type === "math" || (previousBlock?.type === "code" && previousBlock.lang === "math")) ? previousBlock : null;
    let inlineTarget: Content | undefined;
    for (const [index, node] of parent.children.entries()) {
      const blockIndex = rootIndex ?? index;
      if (node.type === "hkbSolutionAnchor") {
        const adjacent = inlineTarget && inlineTarget.position?.end.line === node.position?.start.line;
        const target = display ?? (adjacent && inlineTarget?.type === "inlineMath" ? inlineTarget : null);
        const hasTarget = Boolean(display || adjacent);
        // A standalone progression marker can still end a previous prose block.
        const hasStepTarget = hasTarget || Boolean(markerParagraph && previousBlock && !isMarkerParagraph(previousBlock) &&
          previousBlock.type !== "html" && previousBlock.type !== "definition" && previousBlock.type !== "footnoteDefinition");
        locations.push({ id: node.value.slice(prefix.length, -1), node, blockIndex, target, hasTarget, hasStepTarget,
          placementOffset: (display ?? (adjacent ? inlineTarget : undefined))?.position?.end.offset });
        continue;
      }
      if ("children" in node && node.type !== "link" && node.type !== "linkReference" && node.type !== "footnoteDefinition") {
        visit(node, blockIndex, parent.children[index - 1]);
      }
      // Permit horizontal space after a formula and consecutive markers on the same target.
      if (node.type === "text" && /^[ \t]*$/.test(node.value)) continue;
      inlineTarget = isInlineTarget(node) ? node : undefined;
    }
  }

  visit(tree);
  return locations;
}

export function solutionStepBoundaries(locations: AnchorLocation[], stepIds: string[]) {
  const ids = new Set(stepIds);
  return [...new Set(locatedSolutionAnchors(locations, true).filter(({ id }) => ids.has(id)).map(({ blockIndex }) => blockIndex))];
}

function anchorCounts(locations: AnchorLocation[]) {
  const counts = new Map<string, number>();
  for (const { id } of locations) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export function locatedSolutionAnchors(locations: AnchorLocation[], forSteps = false) {
  const counts = anchorCounts(locations);
  return locations.filter((location) => (forSteps ? location.hasStepTarget : location.hasTarget) && counts.get(location.id) === 1);
}

export function solutionAnnotationPositions(bodyMd: string) {
  const locations = solutionAnchorLocations(parser.parse(bodyMd));
  return new Map(locatedSolutionAnchors(locations).map(({ id, node, target }) => [
    id, (target ?? node).position?.start.line,
  ]));
}

export function solutionAnchorSummaries(bodyMd: string) {
  const lines = bodyMd.split(/\r?\n/);
  return locatedSolutionAnchors(solutionAnchorLocations(parser.parse(bodyMd))).map(({ id, node, target }) => {
    const line = (target ?? node).position?.start.line;
    const raw = target?.value ?? (line ? lines[line - 1] : "");
    return { anchorId: id, line, text: raw.replace(/\[\^hkb-[a-z0-9-]+\]/g, "").trim().slice(0, 160) };
  });
}

export function solutionTextPosition(bodyMd: string, excerpt: string) {
  const tree = parser.parse(bodyMd);
  const bom = Number(bodyMd.charCodeAt(0) === 0xfeff);
  const locations = solutionAnchorLocations(tree);
  const spans = locations.flatMap(({ node }) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start === undefined || end === undefined ? [] : [{ start: start + bom, end: end + bom }];
  });
  // Ignore existing markers when matching a visible excerpt while retaining original offsets for insertion.
  const segments: Array<{ original: number; start: number; text: string }> = [];
  let original = 0;
  let visibleSize = 0;
  for (const { start, end } of [...spans, { start: bodyMd.length, end: bodyMd.length }]) {
    const text = bodyMd.slice(original, start);
    segments.push({ original, start: visibleSize, text });
    visibleSize += text.length;
    original = end;
  }
  const visible = segments.map(({ text }) => text).join("");
  const first = visible.indexOf(excerpt);
  if (first < 0) return { status: "missing" as const };
  if (visible.indexOf(excerpt, first + 1) >= 0) return { status: "ambiguous" as const };
  const last = first + excerpt.length - 1;
  const segment = segments.find(({ start, text }) => start <= last && last < start + text.length)!;
  const lastOffset = segment.original + last - segment.start;
  const anchorAt = (offset: number) => locatedSolutionAnchors(locations)
    .filter(({ placementOffset }) => placementOffset !== undefined && placementOffset + bom >= offset
      && /^[ \t]*$/.test(bodyMd.slice(offset, placementOffset + bom))).map(({ id }) => id);
  function findTarget(parent: Parents): { offset: number; display: boolean } | undefined {
    for (const node of parent.children) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || lastOffset < start + bom || lastOffset >= end + bom) continue;
      if (parent.type === "root" && (node.type === "math" || (node.type === "code" && node.lang === "math"))) {
        return { offset: end + bom, display: true };
      }
      if ((parent.type === "paragraph" || parent.type === "heading" || parent.type === "tableCell") && isInlineTarget(node)) {
        const offset = node.type === "text" ? lastOffset + 1 : end + bom;
        return { offset, display: false };
      }
      if ("children" in node && node.type !== "footnoteDefinition") return findTarget(node);
    }
  }
  const position = findTarget(tree);
  return position ? { status: "found" as const, ...position, anchors: anchorAt(position.offset) } : { status: "unplaced" as const };
}

export function solutionAnchorIds(bodyMd: string) {
  return solutionAnchorLocations(parser.parse(bodyMd)).map(({ id }) => id);
}

export function insertSolutionMarker(bodyMd: string, position: { offset: number; display: boolean }, id: string) {
  const before = bodyMd.slice(0, position.offset);
  const after = bodyMd.slice(position.offset);
  const marker = `${prefix}${id}]`;
  if (!position.display) return before + marker + after;
  const separator = after && !/^(\r?\n){2}/.test(after) ? "\n" : "";
  return before + "\n\n" + marker + separator + after;
}

export function canonicalAnnotationIds(bodyMd: string, ids: string[]) {
  const locations = solutionAnchorLocations(parser.parse(bodyMd));
  const existing = new Set(locations.map(({ id }) => id));
  const placed = new Set(locatedSolutionAnchors(locations).map(({ id }) => id));
  const renamed = new Map<string, string>();
  for (const id of ids) {
    if (!id.startsWith("hkb-") || existing.has(id)) continue;
    const suffix = id.slice(4);
    if (!ids.includes(suffix) && placed.has(suffix)) renamed.set(id, suffix);
  }
  return renamed;
}

type AnchorIssueReason = "missing" | "duplicate" | "unplaced";

export function solutionAnchorReviewIssues({ bodyMd, annotations = [], stepAnchorIds = [] }: {
  bodyMd: string;
  annotations?: readonly { id: string }[];
  stepAnchorIds?: readonly string[];
}) {
  if (!annotations.length && !stepAnchorIds.length) return [];
  const locations = solutionAnchorLocations(parser.parse(bodyMd));
  const counts = anchorCounts(locations);
  const located = new Map(locations.map((location) => [location.id, location]));
  const expected = [
    ...annotations.map(({ id }) => ({ id, kind: "annotation" as const })),
    ...stepAnchorIds.map((id) => ({ id, kind: "step" as const })),
  ];
  return expected.flatMap((entry) => {
    const location = located.get(entry.id);
    const valid = entry.kind === "step" ? location?.hasStepTarget : location?.hasTarget;
    const reason: AnchorIssueReason | null = !location ? "missing" : counts.get(entry.id) !== 1 ? "duplicate" : !valid ? "unplaced" : null;
    return reason ? [{ ...entry, status: "needs_verification" as const, reason }] : [];
  });
}

export function countSolutionSteps(bodyMd: string, stepIds: string[]) {
  const tree = parser.parse(bodyMd);
  const boundaries = solutionStepBoundaries(solutionAnchorLocations(tree), stepIds);
  const end = boundaries.at(-1);
  if (end === undefined) return 0;
  const tail = tree.children.slice(end + 1).some((node) => node.type !== "definition" && node.type !== "footnoteDefinition");
  return boundaries.length + Number(tail);
}

export function exportSolutionMarkdown(bodyMd: string) {
  const locations = solutionAnchorLocations(parser.parse(bodyMd));
  const bom = Number(bodyMd.charCodeAt(0) === 0xfeff);
  let offset = 0;
  const parts = [];
  for (const { node } of locations) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    parts.push(bodyMd.slice(offset, start + bom));
    offset = end + bom;
  }
  parts.push(bodyMd.slice(offset));
  return parts.join("");
}

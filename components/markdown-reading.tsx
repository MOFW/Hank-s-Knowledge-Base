import type { Element, ElementContent, Root } from "hast";
import type { ReactNode } from "react";
import renderMarkdown from "react-markdown";
import type { FeaturedExample } from "@/domain/question-topic";
import { scopedId } from "@/lib/reading-anchor";
import { markdownOptions } from "./markdown";

export type ReadingHeading = { id: string; label: string; level: number };

function headingText(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return "";
  if (node.tagName === "img") return String(node.properties.alt ?? "");
  if (node.tagName === "br") return " ";
  return node.children.map(headingText).join("");
}

function collectHeadings(headings: ReadingHeading[], keepFootnoteLabel: boolean) {
  return (tree: Root) => {
    const usedIds = new Set<string>();
    const nextSuffix = new Map<string, number>();
    function hasH1(parent: Root | Element): boolean {
      return parent.children.some((node) => node.type === "element" && (node.tagName === "h1" || hasH1(node)));
    }
    const containsH1 = hasH1(tree);
    function visit(parent: Root | Element) {
      for (const node of parent.children) {
        if (node.type !== "element") continue;
        if (!/^h[1-6]$/.test(node.tagName)) { visit(node); continue; }
        if (keepFootnoteLabel && node.properties.id === "footnote-label") continue;
        const level = Math.min(Number(node.tagName[1]) + Number(containsH1), 6);
        node.tagName = `h${level}`;
        const label = node.children.map(headingText).join("").replace(/\s+/g, " ").trim();
        if (!label) continue;

        const normalized = label.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "-");
        const slug = [...normalized].slice(0, 96).join("").replace(/^-|-$/g, "");
        const base = `note-${slug || "section"}`;
        let suffix = nextSuffix.get(base) ?? 1;
        let id = suffix === 1 ? base : `${base}-${suffix}`;
        while (usedIds.has(id)) id = `${base}-${++suffix}`;
        usedIds.add(id);
        nextSuffix.set(base, suffix + 1);
        node.properties.id = id;
        node.properties.tabIndex = -1;
        headings.push({ id, label, level });
      }
    }
    visit(tree);
  };
}

function markReadingParagraphs() {
  const occurrences = new Map<string, number>();
  function visit(parent: Root | Element) {
    for (const node of parent.children) {
      if (node.type !== "element") continue;
      if (node.tagName === "p") {
        const text = headingText(node).replace(/\s+/g, " ").trim();
        if (text) {
          let hash = 2166136261;
          for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
          const base = `para-${(hash >>> 0).toString(36)}`;
          const occurrence = (occurrences.get(base) ?? 0) + 1;
          occurrences.set(base, occurrence);
          node.properties.id = `${base}-${occurrence}`;
          node.properties.tabIndex = -1;
        }
      }
      visit(node);
    }
  }
  return visit;
}

function scopeReading(topicId: string) {
  return (tree: Root) => {
    let formula = 0;
    let disclosure = 0;
    function visit(parent: Root | Element) {
      for (const node of parent.children) {
        if (node.type !== "element") continue;
        const props = node.properties;
        if (Array.isArray(props.className) && props.className.includes("katex-display") && !props.id) {
          props.id = `formula-${++formula}`;
        }
        if (node.tagName === "details") props.id ??= `disclosure-${++disclosure}`;
        if (typeof props.id === "string") props.id = scopedId(topicId, props.id);
        if (typeof props.href === "string" && props.href.startsWith("#") && props.href.length > 1) {
          props.href = "#" + scopedId(topicId, props.href.slice(1));
        }
        for (const name of ["ariaDescribedBy", "ariaLabelledBy"]) {
          const value = props[name];
          if (Array.isArray(value)) props[name] = value.map((id) => scopedId(topicId, String(id)));
          if (typeof value === "string") props[name] = value.split(/\s+/).map((id) => scopedId(topicId, id)).join(" ");
        }
        visit(node);
      }
    }
    visit(tree);
  };
}

function placeExamples(
  placements: ReadingHeading[], groups: FeaturedExample[][], examples: FeaturedExample[],
) {
  return (tree: Root) => {
    let heading = "topic-start";
    const positions = new Map<string, { slot: number; order: number }>();
    const proseEnd = tree.children.findIndex((node) => node.type === "element" && "dataFootnotes" in node.properties);
    const end = proseEnd === -1 ? tree.children.length : proseEnd;

    function visit(node: Root["children"][number], index: number, topLevel = false) {
      if (node.type !== "element") return;
      const local = node.properties.id;
      if (typeof local === "string" && local.startsWith("note-") && /^h[1-6]$/.test(node.tagName)) {
        heading = local;
        let slot = index + 1;
        if (topLevel) {
          while (slot < end) {
            const next = tree.children[slot];
            if (next.type === "element" && /^h[1-6]$/.test(next.tagName)) break;
            slot++;
          }
        }
        positions.set(local, { slot, order: positions.size });
        placements.push({ id: local, label: node.children.map(headingText).join("").trim(), level: Number(node.tagName[1]) });
      } else if (typeof local === "string" && local.startsWith("para-")) {
        const id = `${heading}~${local}`;
        positions.set(id, { slot: index + 1, order: positions.size });
        const text = node.children.map(headingText).join("").replace(/\s+/g, " ").trim();
        placements.push({ id, label: [...text].slice(0, 72).join("") + ([...text].length > 72 ? "…" : ""), level: 0 });
      }
      for (const child of node.children) visit(child, index);
    }
    tree.children.slice(0, end).forEach((node, index) => visit(node, index, true));
    const fallback = { slot: end, order: positions.size };
    const arranged = examples.map((example) => ({
      example, position: positions.get(example.placementAnchor ?? "") ?? fallback,
    })).sort((a, b) => a.position.slot - b.position.slot || a.position.order - b.position.order ||
      a.example.displayOrder - b.example.displayOrder || a.example.questionId.localeCompare(b.example.questionId));
    const slots = new Map<number, number>();
    for (const { example, position } of arranged) {
      if (!slots.has(position.slot)) slots.set(position.slot, groups.push([]) - 1);
      groups[slots.get(position.slot)!].push(example);
    }
    for (const [slot, group] of [...slots].reverse()) {
      tree.children.splice(slot, 0, { type: "element", tagName: "div", properties: { dataExampleSlot: group }, children: [] });
    }
  };
}

const readingImagePath = /^\/api\/v1\/assets\/[0-9a-f-]{36}$/i;

export function prepareReading(source: string, topicId?: string, exampleContent?: {
  examples: FeaturedExample[]; render: (example: FeaturedExample) => ReactNode;
}) {
  const headings: ReadingHeading[] = [];
  const placements: ReadingHeading[] = [];
  const groups: FeaturedExample[][] = [];
  const body = renderMarkdown({
    ...markdownOptions,
    children: source,
    rehypePlugins: [[collectHeadings, headings, Boolean(topicId)], ...markdownOptions.rehypePlugins, markReadingParagraphs,
      [placeExamples, placements, groups, exampleContent?.examples ?? []],
      ...(topicId ? [[scopeReading, topicId] as [typeof scopeReading, string]] : [])],
    ...(topicId && { urlTransform: (url: string, key: string) => key === "src" && readingImagePath.test(url) ? url : markdownOptions.urlTransform(url, key) }),
    components: {
      ...markdownOptions.components,
      ...(topicId && {
        img: ({ src, alt }) => typeof src === "string" && readingImagePath.test(src)
          ? <span className="course-reading-image">
            <span className="course-reading-image-fallback">{alt || "图片"} · <a href={src} target="_blank" rel="noreferrer">打开原图</a></span>
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-authenticated local asset */}
            <img src={src} alt={alt ?? ""} loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} />
          </span>
          : <span>{alt ? `[图片：${alt}]` : "[图片]"}</span>,
      }),
      ...(exampleContent && {
        div: ({ node, ...props }) => {
          const group = node?.properties.dataExampleSlot;
          return typeof group === "number" ? <>{groups[group].map(exampleContent.render)}</> : <div {...props} />;
        },
      }),
    },
  });
  return { headings, placements, body: <div className="markdown textbook-prose">{body}</div> };
}

export function ReadingOutline({ headings }: { headings: ReadingHeading[] }) {
  if (!headings.length) return null;
  const firstLevel = Math.min(...headings.map((heading) => heading.level));
  const links = <nav aria-label="本页目录">
    <ol>{headings.map(({ id, label, level }) => (
      <li key={id} data-indent={Math.min(level - firstLevel, 3)}><a href={`#${id}`}>{label}</a></li>
    ))}</ol>
  </nav>;
  return <details className="reading-tool reading-outline"><summary>本页目录</summary>{links}</details>;
}

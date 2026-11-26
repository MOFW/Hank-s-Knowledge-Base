import type { PhrasingContent, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { TopicImportCandidate, TopicSection } from "@/domain/imports";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type SectionKind = TopicSection["kind"] | "example" | "caution";
const sections: Record<SectionKind, readonly [label: string, ...aliases: string[]]> = {
  definition: ["定义", "基本概念", "定义与基本概念", "definition", "definitions"],
  formula: ["公式", "乘法规则", "运算规则", "formula", "formulas"],
  theorem: ["定理", "性质", "定理与性质", "theorem", "theorems"],
  proof: ["证明", "proof", "proofs"],
  intuition: ["直观理解", "直觉", "intuition"],
  derivation: ["推导依据", "推导", "derivation"],
  method: ["解题方法", "常见解题方法", "方法", "method", "methods"],
  example: ["例题", "例子", "示例", "练习", "example", "examples", "exercises"],
  caution: ["易错点", "注意", "注意事项", "pitfalls"],
};
const sectionOrder = Object.keys(sections) as SectionKind[];

function headingText(node: PhrasingContent): string {
  if ("value" in node) return node.value;
  if ("alt" in node) return node.alt ?? "";
  if ("children" in node) return node.children.map(headingText).join("");
  return "";
}

function headingKind(text: string) {
  const title = text.normalize("NFKC").trim().toLowerCase();
  return sectionOrder.find((kind) => sections[kind].some((label) => {
    const name = label.toLowerCase();
    return title === name || (title.startsWith(name) && /^[\s:·、(（]/.test(title.slice(name.length)));
  }));
}

function startOfLine(source: string, offset: number) {
  return Math.max(source.lastIndexOf("\n", offset - 1), source.lastIndexOf("\r", offset - 1)) + 1;
}

function normalizeBlock(markdown: string) {
  return markdown.replace(/\r\n?/g, "\n").replace(/^(?:[\t ]*\n)+|(?:\n[\t ]*)+$/g, "");
}

function safeTitle(title: string) {
  return title.trim().replace(/[\\`*_{}\[\]<>$#|&~!]/g, "\\$&");
}

function openFence(source: string, last: RootContent | undefined) {
  if (last?.type !== "code" || last.position?.start.offset === undefined) return;
  const offset = startOfLine(source, last.position.start.offset);
  const [firstLine, ...lines] = source.slice(offset).split(/\r\n|\r|\n/);
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(firstLine)?.[1];
  if (!fence) return;
  const close = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
  if (!lines.some((line) => close.test(line))) return fence;
}

function sectionBody(kind: TopicSection["kind"], title: string | undefined, markdown: string, depth: number) {
  const label = title ? safeTitle(title) : "";
  if (kind === "proof") {
    const marker = "> [!证明]" + (label ? " " + label : "");
    return [marker, ">", ...markdown.split("\n").map((line) => line ? "> " + line : ">")].join("\n");
  }
  if (!label) return markdown;
  const heading = depth < 6 ? "#".repeat(depth + 1) + " " + label : `**${label}**`;
  return `${heading}\n\n${markdown}`;
}

/** Insert reviewed additions at Markdown block boundaries while retaining the original text. */
export function mergeTopicNote(original: string, candidate: TopicImportCandidate) {
  if (!candidate.sections?.length) return original;
  const tree = parser.parse(original);
  const unclosedOriginalFence = openFence(original, tree.children.at(-1));
  const headings = tree.children.flatMap((node) => node.type === "heading" && node.position?.start.offset !== undefined
    ? [{ depth: node.depth, kind: headingKind(node.children.map(headingText).join("")), offset: startOfLine(original, node.position.start.offset) }]
    : []);
  const [firstHeading] = headings;
  // A leading, standalone H1 is the document title. Keep its section headings beneath it.
  const hasDocumentTitle = firstHeading?.depth === 1 && !firstHeading.kind && headings.filter(({ depth }) => depth === 1).length === 1;
  const sectionHeadings = hasDocumentTitle ? headings.slice(1) : headings;
  const depth = sectionHeadings.length ? Math.min(...sectionHeadings.map((heading) => heading.depth)) : 2;
  const peers = sectionHeadings.filter((heading) => heading.depth === depth);
  const newline = /\r\n|[\r\n]/.exec(original)?.[0] ?? "\n";
  const blockStarts = tree.children.flatMap((node) => node.position?.start.offset === undefined ? [] : [startOfLine(original, node.position.start.offset)]);
  const blockEnds = new Set(tree.children.flatMap((node) => node.position?.end.offset === undefined ? [] : [node.position.end.offset]));
  function containsBlock(markdown: string) {
    const formatted = markdown.replaceAll("\n", newline);
    return blockStarts.some((start) => original.startsWith(formatted, start) && blockEnds.has(start + formatted.length));
  }

  const insertions = new Map<number, string[]>();
  for (const kind of sectionOrder) {
    const seen = new Set<string>();
    const blocks = candidate.sections.flatMap((section) => {
      if (section.kind !== kind) return [];
      const markdown = normalizeBlock(section.content.markdown);
      const unclosed = openFence(markdown, parser.parse(markdown).children.at(-1));
      const content = unclosed ? markdown + "\n" + unclosed : markdown;
      const block = sectionBody(section.kind, section.title, content, depth);
      if (seen.has(markdown) || containsBlock(block) || containsBlock(markdown)) return [];
      seen.add(markdown);
      return [block];
    });
    if (!blocks.length) continue;

    const existing = peers.find(({ kind: existingKind }) => existingKind === kind);
    const next = existing ? sectionHeadings.find(({ offset }) => offset > existing.offset)
      : peers.find((heading) => heading.kind && sectionOrder.indexOf(heading.kind) > sectionOrder.indexOf(kind));
    const offset = next?.offset ?? original.length;
    if (!existing) blocks.unshift(`${"#".repeat(depth)} ${sections[kind][0]}`);
    insertions.set(offset, [...(insertions.get(offset) ?? []), ...blocks]);
  }

  let cursor = 0;
  let result = "";
  for (const [offset, blocks] of [...insertions].sort(([a], [b]) => a - b)) {
    let preceding = original.slice(cursor, offset);
    if (offset === original.length && unclosedOriginalFence) {
      // Close an original EOF fence only when adding text after it.
      if (!/[\r\n]$/.test(preceding)) preceding += newline;
      preceding += unclosedOriginalFence;
    }
    result += preceding;
    if (offset > 0) {
      const trailing = /(?:\r\n|\r|\n){1,2}$/.exec(preceding)?.[0];
      const lineBreaks = trailing?.match(/\r\n|\r|\n/g)?.length ?? 0;
      result += newline.repeat(2 - lineBreaks);
    }
    result += blocks.join("\n\n").replaceAll("\n", newline);
    if (offset < original.length) result += newline.repeat(2);
    cursor = offset;
  }
  return result + original.slice(cursor);
}

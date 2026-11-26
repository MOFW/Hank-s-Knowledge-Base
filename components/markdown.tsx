import cpp from "highlight.js/lib/languages/cpp";
import type { Element, Root } from "hast";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { katexOptions } from "@/lib/math-rendering";
import { AppLink } from "./app-link";

const studyBlocks = {
  DEFINITION: { label: "定义", kind: "definition" }, 定义: { label: "定义", kind: "definition" },
  THEOREM: { label: "定理", kind: "theorem" }, 定理: { label: "定理", kind: "theorem" },
  PROOF: { label: "证明", kind: "proof" }, 证明: { label: "证明", kind: "proof" },
  EXAMPLE: { label: "例题", kind: "example" }, 例题: { label: "例题", kind: "example" },
  NOTE: { label: "注意", kind: "note" }, 注意: { label: "注意", kind: "note" },
  DETAILS: { label: "补充解释", kind: "details" }, 补充: { label: "补充解释", kind: "details" },
} as const;

// Only these authored blockquote markers produce containers. Raw HTML remains disabled.
function studyCallouts() {
  return function visit(parent: Root | Element) {
    for (const node of parent.children) {
      if (node.type !== "element") continue;
      visit(node);
      if (node.tagName !== "blockquote") continue;
      const paragraph = node.children.find((child) => child.type === "element" && child.tagName === "p");
      if (paragraph?.type !== "element" || paragraph.children[0]?.type !== "text") continue;
      const text = paragraph.children[0];
      const match = /^\[!([A-Z]+|定义|定理|证明|例题|注意|补充)\](?:[ \t]+([^\n]*))?(?:\n|$)/.exec(text.value);
      if (!match || !(match[1] in studyBlocks)) continue;
      const block = studyBlocks[match[1] as keyof typeof studyBlocks];
      const collapsible = block.kind === "proof" || block.kind === "details";
      text.value = text.value.slice(match[0].length);
      if (!text.value) paragraph.children.shift();
      if (!paragraph.children.length) node.children = node.children.filter((child) => child !== paragraph);
      node.tagName = collapsible ? "details" : "section";
      node.properties = { className: ["study-callout", `study-${block.kind}`] };
      node.children.unshift({
        type: "element", tagName: collapsible ? "summary" : "div", properties: { className: ["study-callout-title"] },
        children: [{ type: "text", value: match[2]?.trim() ? `${block.label} · ${match[2].trim()}` : block.label }],
      });
    }
  };
}

function safeLink(url: string) {
  if (/^(https?:\/\/|mailto:|#)/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  return undefined;
}

function formatMath() {
  function visit(parent: Root | Element) {
    for (const node of parent.children) {
      if (node.type !== "element") continue;
      const classes = node.properties.className;
      if (Array.isArray(classes) && classes.includes("katex-display")) {
        Object.assign(node.properties, { tabIndex: 0, role: "region", ariaLabel: "可滚动公式" });
      } else if (Array.isArray(classes) && classes.includes("katex")) {
        const math: Element = { ...node, properties: { ...node.properties } };
        node.properties = { className: ["inline-math"] };
        node.children = [math];
      } else {
        visit(node);
      }
    }
  }
  return visit;
}

export const markdownOptions = {
  skipHtml: true,
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [
    studyCallouts,
    [rehypeKatex, katexOptions],
    [rehypeHighlight, { languages: { cpp }, aliases: { cpp: ["c++", "cxx"] } }],
    formatMath,
  ],
  urlTransform: (url, key) => key === "href" ? safeLink(url) : undefined,
  components: {
    // ReactMarkdown supplies the source node alongside the native anchor attributes.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    a: ({ node, href, children, ...props }) => href ? <AppLink href={href} {...props}>{children}</AppLink> : <span>{children}</span>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    details: ({ node, ...props }) => <details {...props} suppressHydrationWarning />,
    img: ({ alt }) => <span>{alt ? `[图片：${alt}]` : "[图片]"}</span>,
    pre: ({ children }) => <pre tabIndex={0} role="region" aria-label="可滚动代码块">{children}</pre>,
    table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label="可滚动表格"><table>{children}</table></div>,
  },
} satisfies Options;

export function Markdown({ source }: { source: string }) {
  return <div className="markdown"><ReactMarkdown {...markdownOptions}>{source}</ReactMarkdown></div>;
}

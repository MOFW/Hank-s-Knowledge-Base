import { renderToString } from "katex";
import type { Nodes } from "mdast";
import type { ReactNode } from "react";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { katexOptions } from "@/lib/math-rendering";

const parser = unified().use(remarkParse).use(remarkMath).freeze();

export function QuestionTitle({ text }: { text: string }) {
  if (!text.includes("$")) return text;
  // A dollar before a standalone amount must not capture the next formula's delimiter.
  // Keep offsets unchanged so all non-math text comes from the original title.
  const source = text.replace(/\$(?=\d+(?:[,.]\d+)*(?:$|[，。；、！？,;!?]|\s+(?![\s+*/=\\^_<>-])))/g, "＄");
  const parts: ReactNode[] = [];
  let offset = 0;
  function visit(node: Nodes) {
    if (node.type === "inlineMath") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      try {
        const html = renderToString(node.value, { ...katexOptions, throwOnError: true, strict: "ignore" });
        parts.push(text.slice(offset, start),
          <span key={start} className="question-title-math" dangerouslySetInnerHTML={{ __html: html }} />);
        offset = end;
      } catch {
        // Leave the invalid formula in the next plain-text slice.
      }
    } else if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  }
  visit(parser.parse(source));
  if (!parts.length) return text;
  return <span className="question-title">{parts}{text.slice(offset)}</span>;
}

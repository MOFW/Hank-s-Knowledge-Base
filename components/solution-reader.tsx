"use client";

import { AppLink } from "@/components/app-link";
import type { Element, Root as HtmlRoot } from "hast";
import type { Root } from "mdast";
import { ChevronDown, CircleHelp } from "lucide-react";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Markdown, markdownOptions } from "@/components/markdown";
import { importTextLabels } from "@/domain/import-solution";
import type { SolutionAnnotation, SolutionDocument, SolutionStep } from "@/domain/solution";
import type { SolutionLayers, SolutionThread } from "@/domain/solution-layers";
import { countSolutionSteps, locatedSolutionAnchors, remarkSolutionAnchors, solutionAnchorLocations, solutionStepBoundaries } from "@/lib/solution-anchors";

export type SolutionTopic = { id: string; title: string };
type Note = SolutionAnnotation | SolutionStep;

const noteParts = [
  ["推导依据", "basisMd"],
  ["思路来源", "strategyMd"],
  ["", "explanationMd"],
  ["AI 补充说明", "aiExplanationMd"],
  ["易错点", "commonMistakesMd"],
] as const;

function hasExplanation(note: Note, topics: SolutionTopic[]) {
  return ("learnerQuestionsMd" in note && note.learnerQuestionsMd?.some((md) => md.trim()))
    || noteParts.some(([, field]) => note[field].trim()) || topics.some(({ id }) => note.topicIds.includes(id));
}

function ExplanationContent({ note, topics, thread, audit }: {
  note: Note; topics: SolutionTopic[]; thread?: SolutionThread; audit: boolean;
}) {
  const linked = audit ? topics.filter(({ id }) => note.topicIds.includes(id)) : [];
  const questions = "learnerQuestionsMd" in note ? [...new Set(note.learnerQuestionsMd?.map((md) => md.trim()).filter(Boolean))] : [];
  const remainingQuestions = questions.filter((md) => !thread?.turns.some(({ learner }) => learner.markdown.trim() === md));
  return <>
    {"label" in note && note.label && (audit || !thread && !questions.length) && <p className="solution-note-title">{note.label}</p>}
    {remainingQuestions.map((source) => <div className="solution-note-title" key={source}><Markdown source={source} /></div>)}
    {noteParts.map(([label, field]) => {
      const origin = field !== "aiExplanationMd" && "noteOrigins" in note ? note.noteOrigins?.[field] : undefined;
      const heading = audit ? [label, origin && importTextLabels[origin]].filter(Boolean).join(" · ")
        : field === "commonMistakesMd" ? label : "";
      return note[field].trim() && <div key={field}>
        {heading && <p className="solution-note-label">{heading}</p>}
        <Markdown source={note[field]} />
      </div>;
    })}
    {linked.length > 0 && <div>
      <p className="solution-note-label">相关知识点</p>
      <ul className="topic-tags">{linked.map(({ id, title }) => <li key={id}><AppLink href={`/topics/${id}`}>{title}</AppLink></li>)}</ul>
    </div>}
  </>;
}

type Disclosures = {
  prefix: string;
  notes: Map<string, Note>;
  threads: Map<string, SolutionThread>;
  topics: SolutionTopic[];
  annotationDetails?: Record<string, ReactNode>;
  open: Set<string>;
  toggle: (id: string) => void;
};
const SolutionDisclosures = createContext<Disclosures | null>(null);

function ExplanationMarker({ anchor }: { anchor: string }) {
  const disclosure = useContext(SolutionDisclosures);
  const note = disclosure?.notes.get(anchor);
  if (!disclosure || !note && !disclosure.threads.has(anchor)) return null;
  const label = (note && ("title" in note ? note.title : note.label)) || "此处的推导";
  const { prefix, open, toggle } = disclosure;
  return <button type="button" className="solution-marker" data-solution-marker={anchor}
    id={`${prefix}-marker-${anchor}`} aria-controls={`${prefix}-note-${anchor}`} aria-expanded={open.has(anchor)}
    aria-label={`深入解释：${label}`} title={`深入解释：${label}`} onClick={() => toggle(anchor)}>
    <CircleHelp size={17} aria-hidden="true" />
  </button>;
}

function ExplanationPanel({ anchors }: { anchors: string[] }) {
  const disclosure = useContext(SolutionDisclosures);
  if (!disclosure) return null;
  const [anchor] = anchors;
  const { prefix, open, toggle, topics } = disclosure;
  const markerId = `${prefix}-marker-${anchor}`;
  function close() {
    toggle(anchor);
    const marker = document.getElementById(markerId);
    marker?.focus({ preventScroll: true });
    requestAnimationFrame(() => marker?.scrollIntoView({ block: "nearest" }));
  }
  return <div className="solution-note" id={`${prefix}-note-${anchor}`} role="region" aria-labelledby={markerId}
    tabIndex={-1} hidden={!open.has(anchor)} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      close();
    }}>
    {open.has(anchor) && <>
      {anchors.map((id) => {
        const thread = disclosure.threads.get(id);
        const note = disclosure.notes.get(id);
        return <div className="solution-turn" key={id} id={id === anchor ? undefined : `${prefix}-note-${id}`} tabIndex={id === anchor ? undefined : -1}>
          {thread?.turns.map(({ id: turnId, learner, replies }) => <div className="solution-turn" key={turnId}>
            <div className="solution-note-title"><Markdown source={learner.markdown} /></div>
            {replies.map((reply, index) => <Markdown key={index} source={reply.markdown} />)}
          </div>)}
          {note && <ExplanationContent note={note} topics={topics} thread={thread} audit={Boolean(disclosure.annotationDetails)} />}
          {disclosure.annotationDetails?.[id]}
        </div>;
      })}
    </>}
    {!open.has(anchor) && anchors.slice(1).map((id) => <span key={id} id={`${prefix}-note-${id}`} />)}
    {open.has(anchor) && <button type="button" className="text-link solution-note-close" onClick={close}>收起解释 <ChevronDown size={14} aria-hidden="true" /></button>}
  </div>;
}

function annotateSolution({ annotationIds, stepIds, visible }: { annotationIds: string[]; stepIds: string[]; visible?: number }) {
  return (tree: Root) => {
    const locations = solutionAnchorLocations(tree);
    const activeIds = new Set(annotationIds);
    const targets = new Set(locatedSolutionAnchors(locations).filter(({ id }) => activeIds.has(id)).map(({ node }) => node));
    for (const { id, node, target } of locations) {
      if (targets.has(node)) {
        node.data = { hName: "span", hProperties: { dataSolutionMarker: id }, hChildren: [] };
        if (target && target.type !== "inlineMath") {
          const data = target.data ??= {};
          const properties = data.hProperties ??= {};
          const previous = properties.dataSolutionMath;
          properties.dataSolutionMath = typeof previous === "string" ? `${previous} ${id}` : id;
        }
      } else {
        node.value = "";
      }
    }
    const boundaries = solutionStepBoundaries(locations, stepIds);
    const last = visible === undefined ? undefined : boundaries[visible - 1];
    if (last !== undefined) {
      tree.children = tree.children.filter((node, index) => index <= last || node.type === "definition" || node.type === "footnoteDefinition");
    }
  };
}

// Resolve the display position before KaTeX replaces the formula nodes.
function insertExplanationPanels(legacyAnchor?: string) {
  const containers = new Set(["blockquote", "section", "details", "ul", "ol", "li"]);
  const prose = /^(p|h[1-6])$/;
  const isBlank = (node: HtmlRoot["children"][number]) => node.type === "text" && !node.value.trim();
  const element = (tagName: string, properties: Element["properties"], children: Element["children"] = []): Element =>
    ({ type: "element", tagName, properties, children });

  function collect(parent: Element, anchors: string[]) {
    parent.children = parent.children.filter((child) => {
      if (child.type !== "element") return true;
      if (typeof child.properties.dataSolutionMarker === "string") {
        anchors.push(child.properties.dataSolutionMarker);
        return false;
      }
      collect(child, anchors);
      return true;
    });
  }

  function hasProse(node: Element): boolean {
    const classes = node.properties.className;
    if (Array.isArray(classes) && classes.some((name) => name === "math-inline" || name === "math-display")) return false;
    return node.children.some((child) => child.type === "text" ? Boolean(child.value.trim())
      : child.type === "element" && hasProse(child));
  }

  function visit(parent: HtmlRoot | Element) {
    // Tight Markdown lists omit the p around leading prose.
    if (parent.type === "element" && parent.tagName === "li") {
      const block = parent.children.findIndex((child) => child.type === "element" &&
        (containers.has(child.tagName) || /^(p|pre|table|h[1-6])$/.test(child.tagName)));
      const end = block < 0 ? parent.children.length : block;
      const leading = parent.children.slice(0, end);
      if (leading.some((child) => !isBlank(child))) parent.children.splice(0, end, element("p", { className: ["solution-list-prose"] }, leading));
    }
    const groups = new Map<Element, string[]>();
    let previousProse: Element | undefined;
    const children = parent.children.filter((node) => {
      if (node.type !== "element") return true;
      if (containers.has(node.tagName)) {
        visit(node);
        previousProse = undefined;
        return true;
      }
      const formula = node.tagName === "pre" && node.children[0]?.type === "element" ? node.children[0] : undefined;
      const formulaClasses = formula?.properties.className;
      if (formula && Array.isArray(formulaClasses) && (formulaClasses.includes("math-display") || formulaClasses.includes("language-math"))) {
        const ids = formula.properties.dataSolutionMath ?? node.properties.dataSolutionMath;
        delete formula.properties.dataSolutionMath;
        delete node.properties.dataSolutionMath;
        if (typeof ids === "string") {
          const host = previousProse ?? node;
          groups.set(host, [...(groups.get(host) ?? []), ...ids.split(" ")]);
        }
        return true;
      }
      const anchors: string[] = [];
      collect(node, anchors);
      if (node.tagName === "p" && node.children.every(isBlank)) return false;
      if (anchors.length) groups.set(node, anchors);
      previousProse = node.tagName === "p" && hasProse(node) ? node : undefined;
      return true;
    });
    if (legacyAnchor && parent.type === "root") {
      const host = children.findLast((child): child is Element => child.type === "element");
      if (host) groups.set(host, [legacyAnchor]);
      else if (!children.some((child) => !isBlank(child))) {
        const empty = element("div", {});
        children.push(empty);
        groups.set(empty, [legacyAnchor]);
      }
    }
    parent.children = children.flatMap((node): typeof children => {
      if (node.type !== "element") return [node];
      const anchors = groups.get(node);
      if (!anchors?.length) return [node];
      const marker = element("span", { dataSolutionMarker: anchors[0] });
      const panel = element("div", { dataSolutionPanel: anchors.join(" ") });
      if (prose.test(node.tagName)) {
        node.children.push(marker);
        return [node, panel];
      }
      return [node, element("div", { className: ["solution-marker-row"] }, [marker]), panel];
    });
  }
  return visit;
}

const anchoredComponents: Components = {
  ...markdownOptions.components,
  span: ({ node, ...props }) => typeof node?.properties.dataSolutionMarker === "string"
    ? <ExplanationMarker anchor={node.properties.dataSolutionMarker} /> : <span {...props} />,
  div: ({ node, ...props }) => typeof node?.properties.dataSolutionPanel === "string"
    ? <ExplanationPanel anchors={node.properties.dataSolutionPanel.split(" ")} /> : <div {...props} />,
};

function AnchoredMarkdown({ source, annotationIds, stepIds, visible, legacyAnchor }: {
  source: string;
  annotationIds: string[];
  stepIds: string[];
  visible?: number;
  legacyAnchor?: string;
}) {
  return <div className="markdown solution-prose"><ReactMarkdown {...markdownOptions}
    remarkPlugins={[...markdownOptions.remarkPlugins, remarkSolutionAnchors, [annotateSolution, { annotationIds, stepIds, visible }]]}
    rehypePlugins={[[insertExplanationPanels, legacyAnchor], ...markdownOptions.rehypePlugins]}
    components={anchoredComponents}>{source}</ReactMarkdown></div>;
}

function StepPassages({ steps, stepwise, visible, notes }: {
  steps: SolutionStep[];
  stepwise: boolean;
  visible: number;
  notes: Map<string, Note>;
}) {
  return <div className="solution-prose">
    {steps.slice(0, stepwise ? visible : steps.length).map((step, index) => <div className="solution-passage" key={step.id} data-step-id={step.id}>
      {stepwise && <h3>{index + 1}. {step.title}</h3>}
      {notes.has(step.id) ? <AnchoredMarkdown source={step.bodyMd} annotationIds={[]} stepIds={[]} legacyAnchor={step.id} />
        : <Markdown source={step.bodyMd} />}
    </div>)}
  </div>;
}

function SolutionBody({ scope, document, steps, topics, answerMd, threads = [], annotationDetails }: {
  scope: string;
  document?: SolutionDocument | null;
  steps: SolutionStep[];
  topics: SolutionTopic[];
  answerMd: string;
  threads?: SolutionThread[];
  annotationDetails?: Record<string, ReactNode>;
}) {
  const [visible, setVisible] = useState<number>();
  const [open, setOpen] = useState(new Set<string>());
  const prefix = `solution-${scope}`;
  const bodyRef = useRef<HTMLDivElement>(null);
  const stepIds = document?.stepAnchorIds ?? [];
  const anchoredSteps = document && stepIds.length ? countSolutionSteps(document.bodyMd, stepIds) : 0;
  const count = anchoredSteps || steps.length;
  const stepwise = visible !== undefined;
  const useLegacySteps = stepwise && !anchoredSteps && steps.length > 0 || !document && !answerMd.trim();
  const annotationTopics = annotationDetails ? topics : [];
  const notes = new Map((useLegacySteps ? steps : document?.annotations ?? [])
    .filter((note) => hasExplanation(note, annotationTopics)).map((note) => [note.id, note]));

  function setProgress(next: number | undefined) {
    setVisible(next);
    setOpen(new Set());
    if (next === undefined || next === 1) bodyRef.current?.focus({ preventScroll: true });
  }

  const disclosures = {
    prefix, notes, topics, open, annotationDetails,
    threads: new Map(useLegacySteps ? [] : threads.map((thread) => [thread.anchorId, thread])),
    toggle(id: string) {
      setOpen((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    },
  };

  return <SolutionDisclosures.Provider value={disclosures}>
    {(count > 1 || steps.length > 0 && !useLegacySteps || stepwise) && <div className="solution-progress">
      <button type="button" className="text-link" aria-controls={`${prefix}-body`}
        onClick={() => setProgress(stepwise ? undefined : 1)}>{stepwise ? "阅读完整解答" : "分步阅读"}</button>
      {stepwise && <p className="field-hint" role="status">已展开 {Math.min(visible, count)} / {count} 步</p>}
    </div>}
    <div id={`${prefix}-body`} ref={bodyRef} tabIndex={-1}>
      {useLegacySteps ? <StepPassages steps={steps} stepwise={stepwise} visible={visible ?? count} notes={notes} />
        : document ? <AnchoredMarkdown source={document.bodyMd}
          annotationIds={[...notes.keys(), ...disclosures.threads.keys()]} stepIds={stepIds} visible={visible} />
          : <div className="solution-prose"><Markdown source={answerMd} /></div>}
    </div>
    {stepwise && visible < count && <button type="button" className="button small solution-next" aria-controls={`${prefix}-body`}
      onClick={() => {
        setVisible(visible + 1);
        if (visible + 1 === count) bodyRef.current?.focus({ preventScroll: true });
      }}>展开下一步</button>}
    {stepwise && visible === count && <button type="button" className="text-link solution-next" aria-controls={`${prefix}-body`}
      onClick={() => setProgress(1)}>从第一步重新阅读</button>}
  </SolutionDisclosures.Provider>;
}

const commonSummaryTitle = /^(方法总结(与解题启发)?|思路与关键技巧|解题技巧)$/;

export function SolutionReader({ scope, document, steps, topics, answerMd, review = false, layers, techniquesMd, annotationDetails, extraSupplements }: {
  scope: string;
  document?: SolutionDocument | null;
  steps: SolutionStep[];
  topics: SolutionTopic[];
  answerMd: string;
  review?: boolean;
  layers?: SolutionLayers | null;
  techniquesMd?: string;
  annotationDetails?: Record<string, ReactNode>;
  extraSupplements?: ReactNode;
}) {
  const hasAnswer = Boolean(document || answerMd.trim() || steps.length);
  const content = hasAnswer ? <SolutionBody scope={scope} document={document} steps={steps} topics={topics}
    answerMd={answerMd} threads={layers?.mainThreads} annotationDetails={annotationDetails} />
    : <p className="empty">{review ? "尚未记录参考答案。可以根据自己的解题过程自评。" : "尚未记录详细解答。"}</p>;
  const alternatives = layers?.alternatives ?? [];
  const supplements = layers?.supplements ?? [];
  const techniques = techniquesMd?.trim().replace(/\r\n?/g, "\n");
  const matchingSupplement = techniques && supplements.find(({ body }) => body.markdown.trim().replace(/\r\n?/g, "\n") === techniques);
  return <div className="solution-reader">
    {review ? content : <div id="final-answer" tabIndex={-1}>{content}</div>}
    {alternatives.length > 0 && <section className="solution-alternatives" aria-labelledby={`solution-${scope}-alternatives`}>
      <h2 id={`solution-${scope}-alternatives`}>其他解法</h2>
      {alternatives.map(({ id, title, body, stepAnchorIds, threads }) => {
        const alternativeScope = `${scope}--alternative-${id}`;
        return <details className="solution-alternative" key={id} id={`solution-${alternativeScope}`} suppressHydrationWarning>
          <summary><span>{title}</span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="solution-alternative-body">
            <SolutionBody scope={alternativeScope} document={{ bodyMd: body.markdown, annotations: [], stepAnchorIds }}
              steps={[]} topics={topics} answerMd="" threads={threads} />
          </div>
        </details>;
      })}
    </section>}
    {(supplements.length > 0 || techniques || extraSupplements) && <details className="solution-supplements" suppressHydrationWarning>
      <summary>方法总结与解题启发<ChevronDown size={17} aria-hidden="true" /></summary>
      <div className="solution-supplements-body">
        {supplements.map(({ id, title, body }) => <section key={id} id={`solution-${scope}--supplement-${id}`} tabIndex={-1}>
          {!commonSummaryTitle.test(title) && <h3>{title}</h3>}
          <div id={!review && matchingSupplement && matchingSupplement.id === id ? "key-techniques" : undefined} tabIndex={-1}>
            <Markdown source={body.markdown} />
          </div>
        </section>)}
        {techniques && !matchingSupplement && <div id={review ? undefined : "key-techniques"} tabIndex={-1}><Markdown source={techniques} /></div>}
        {extraSupplements}
      </div>
    </details>}
  </div>;
}

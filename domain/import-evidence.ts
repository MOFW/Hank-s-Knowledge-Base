import katex from "katex";
import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { contextCandidateIssues, contextImportNamespace, contextQuoteFor, contextSourceIssues } from "./context-reference.ts";
import { historyImportNamespace, historySpeaker, revisionLocatorPattern } from "./history-reference.ts";
import type { AnyImportCandidate, Evidence, ImportBatch, ImportCandidate, ImportIssue, ImportSource, ImportText, TopicImportCandidate } from "@/domain/imports";
import { solutionAnchorReviewIssues } from "../lib/solution-anchors.ts";

export type EvidenceGroup = {
  path: string;
  evidence: Evidence[];
  origin?: ImportText["origin"];
};

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const encoder = new TextEncoder();
const unsupportedMath = /\\+\([^\r\n]+?\\+\)|\\+\[[\s\S]+?\\+\]/;

function evidenceInspector(candidate: AnyImportCandidate, sources: ImportSource[], namespace?: string) {
  const sourceKeys = candidate.source_keys;
  const context = namespace === contextImportNamespace;
  const issues: ImportIssue[] = context ? [...contextSourceIssues(sources), ...contextCandidateIssues(candidate)] : [];
  const groups: EvidenceGroup[] = [];
  const sourcesByKey = new Map(sources.map((source) => [source.source_key, source]));
  const issue = (path: string, code: string, message: string, severity: ImportIssue["severity"] = "blocking") =>
    issues.push({ path, code, message, severity });

  function sourceReference(sourceKey: string, at: string) {
    const source = sourcesByKey.get(sourceKey);
    if (!source || ((context || sourceKeys) && !sourceKeys?.includes(sourceKey))) {
      issue(at + "/source_key", "UNKNOWN_SOURCE", "证据必须引用此候选项声明的批次来源。");
    } else if (source.acquisition_status === "unavailable") {
      issue(at + "/source_key", "UNAVAILABLE_SOURCE", "来源无法取得，无法核实这条证据。");
    }
    return source;
  }

  function evidence(path: string, entries: Evidence[], origin?: ImportText["origin"]) {
    groups.push({ path, evidence: entries, origin });
    entries.forEach((entry, index) => {
      const at = `${path}/evidence/${index}`;
      const source = sourceReference(entry.source_key, at);
      if (!context && (entry.history || (namespace === historyImportNamespace && source?.kind === "chat"))) {
        if (source?.kind !== "chat" || !entry.history || !revisionLocatorPattern.test(entry.locator)) {
          issue(at, "HISTORY_REFERENCE_REQUIRED", "历史引文须保留修订定位、原始位置与原始角色。");
        } else if (entry.speaker !== historySpeaker(entry.history.role)) {
          issue(at + "/speaker", "HISTORY_ROLE_MISMATCH", "证据角色须与原始发言角色一致。");
        }
      }
      if (!entry.locator.trim()) issue(at + "/locator", "LOCATOR_REQUIRED", "请注明可核对的位置。");
      if (encoder.encode(entry.quote).length > 16384) issue(at + "/quote", "BYTE_LIMIT", "引文最多 16 KiB。");
    });
  }

  function markdown(path: string, value: string | undefined, limit: number) {
    if (value === undefined) return;
    if (encoder.encode(value).length > limit) {
      issue(path, "BYTE_LIMIT", `Markdown 最多 ${limit / 1024} KiB。`);
      return;
    }
    let unsafe = false;
    let badMath = false;
    let unsupportedDelimiter = false;
    const macros = {};
    const nodes: Nodes[] = [parser.parse(value)];
    while (nodes.length) {
      const node = nodes.pop()!;
      if ("children" in node) for (let i = node.children.length - 1; i >= 0; i--) nodes.push(node.children[i]);
      if (node.type === "html" || (("url" in node) && /^(?:javascript|data|vbscript):/i.test(node.url))) unsafe = true;
      if (context && node.type === "text" && node.position && !unsupportedDelimiter) {
        unsupportedDelimiter = unsupportedMath.test(value.slice(node.position.start.offset, node.position.end.offset));
      }
      const displayMode = node.type === "math" || (node.type === "code" && node.lang === "math");
      if (badMath || (!displayMode && node.type !== "inlineMath")) continue;
      try {
        if ("value" in node) katex.renderToString(node.value, { displayMode, trust: false, maxExpand: 200, maxSize: 12, macros });
      } catch {
        badMath = true;
      }
    }
    if (unsafe) issue(path, "UNSAFE_MARKDOWN", "阅读器会过滤原始 HTML 或不安全链接。", "notice");
    if (badMath) issue(path, "LATEX_NEEDS_VERIFICATION", "公式无法渲染，请核对并修订 LaTeX。");
    if (unsupportedDelimiter) issue(path, "UNSUPPORTED_MATH_DELIMITER", "请用 $…$ 写行内公式，用独立行的 $$…$$ 写展示公式。原文引句应保留原样。");
  }

  function text(path: string, value: ImportText | undefined, limit: number) {
    if (!value) return;
    markdown(path + "/markdown", value.markdown, limit);
    if (value.evidence) evidence(path, value.evidence, value.origin);
    if (context && value.origin === "quoted" && !contextQuoteFor(value.markdown, value.evidence)) {
      issue(path, path === "/statement" ? "CONTEXT_STATEMENT_QUOTE_MISMATCH" : "CONTEXT_QUOTE_MISMATCH",
        "标为逐字引用的正文须完整出现在该字段的一条引句中。转述或 AI 整理须使用对应来源类型。");
    }
  }

  function unique(path: string, ids: string[]) {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) issue(`${path}/${index}`, "DUPLICATE_ID", `标识「${id}」重复。`);
      seen.add(id);
    });
    return seen;
  }

  sourceKeys?.forEach((key, index) => {
    if (!sourcesByKey.has(key)) issue(`/source_keys/${index}`, "UNKNOWN_SOURCE", `来源「${key}」未在批次中声明。`);
  });
  function finish() {
    if (context && !groups.some(({ evidence }) => evidence.length)) {
      issue("/source_keys", "CONTEXT_QUOTE_REQUIRED", "请提供可供审核的对话原话。");
    }
    return { issues, groups };
  }
  return { issue, evidence, markdown, text, unique, sourcesByKey, sourceReference, finish };
}

export function inspectCandidate(candidate: ImportCandidate, sources: ImportSource[], schemaVersion: ImportBatch["schema_version"], namespace?: string) {
  const { issue, evidence, markdown, text, unique, sourcesByKey, sourceReference, finish } =
    evidenceInspector(candidate, sources, namespace);
  const context = namespace === contextImportNamespace;
  if (context && schemaVersion !== "1.2") {
    issue("/schema_version", "CONTEXT_SCHEMA_VERSION", "对话可见片段须使用 v1.2。");
  }
  const document = candidate.solution_document;
  const steps = candidate.solution_steps ?? [];
  const annotations = document?.annotations ?? [];
  const stepIds = unique("/solution_steps", steps.map(({ id }) => id));
  const annotationIds = unique("/solution_document/annotations", annotations.map(({ id }) => id));
  unique("/learner_questions", (candidate.learner_questions ?? []).map(({ id }) => id));
  unique("/evidenced_mistakes", (candidate.evidenced_mistakes ?? []).map(({ id }) => id));
  unique("/attempts", (candidate.attempts ?? []).map(({ external_id }) => external_id));
  if (schemaVersion !== "1.0" && candidate.operation === "create" && !candidate.source_keys?.some((key) => {
    const source = sourcesByKey.get(key);
    return source && source.acquisition_status !== "unavailable";
  })) {
    issue("/source_keys", "SOURCE_NEEDS_VERIFICATION", "缺少可核对的题目来源。");
  }
  if (candidate.operation === "create" && !candidate.statement && !candidate.original_asset_ids?.length && !candidate.history_images?.length) {
    issue("/statement", "STATEMENT_NEEDS_VERIFICATION", "缺少题干或可核对的原题图。");
  }
  candidate.history_images?.forEach((image, index) => {
    const path = `/history_images/${index}`;
    if (sourceReference(image.source_key, path)?.kind !== "chat" || !candidate.source_keys?.includes(image.source_key)) {
      issue(path + "/source_key", "INVALID_IMAGE_SOURCE", "请将这张历史图片关联到候选题目声明的聊天来源。");
    }
  });
  for (const gap of candidate.gaps ?? []) {
    const affectsStatement = /^\/statement(?:\/|$)/.test(gap.field_path);
    const affectsSource = schemaVersion !== "1.0" && /^\/(?:source_keys|sources)(?:\/|$)/.test(gap.field_path);
    const affectsContextImage = context && /^\/original_asset_ids(?:\/|$)/.test(gap.field_path);
    issue(gap.field_path, "DECLARED_GAP", gap.note,
      gap.status === "needs_verification" || affectsStatement || affectsSource || affectsContextImage ? "blocking" : "notice");
  }
  text("/statement", candidate.statement, 131072);
  text("/final_answer", candidate.final_answer, 131072);
  text("/key_techniques", candidate.key_techniques, 131072);
  text("/solution_document/body", document?.body, 131072);
  markdown("/ai_notes_md", candidate.ai_notes_md, 131072);
  for (const { path, ...notes } of [
    ...steps.map((step) => ({ ...step, path: "/solution_steps/" + step.id })),
    ...annotations.map((annotation) => ({ ...annotation, path: "/solution_document/annotations/" + annotation.id })),
  ]) {
    text(path + "/basis", notes.basis, 16384);
    text(path + "/strategy", notes.strategy, 16384);
    text(path + "/explanation", notes.explanation, 16384);
    markdown(path + "/ai_explanation_md", notes.ai_explanation_md, 16384);
    if ("body" in notes) text(path + "/body", notes.body, 32768);
    if ("common_mistakes" in notes) text(path + "/common_mistakes", notes.common_mistakes, 16384);
  }
  if (document) {
    for (const anchor of solutionAnchorReviewIssues({
      bodyMd: document.body.markdown, annotations, stepAnchorIds: document.step_anchor_ids,
    })) {
      const reason = { missing: "缺失", duplicate: "重复", unplaced: "位置无效" }[anchor.reason];
      issue(anchor.kind === "step" ? "/solution_document/step_anchor_ids" : `/solution_document/annotations/${anchor.id}`,
        "INVALID_ANCHOR", `锚点「${anchor.id}」${reason}。`);
    }
  }
  for (const question of candidate.learner_questions ?? []) {
    const path = `/learner_questions/${question.id}`;
    if (question.annotation_id && !annotationIds.has(question.annotation_id)) {
      issue(path + "/annotation_id", "UNKNOWN_ANNOTATION", "疑问指向的注释未在候选解答中定义。");
    }
    markdown(path + "/question_md", question.question_md, 16384);
    evidence(path, question.evidence);
  }
  for (const mistake of candidate.evidenced_mistakes ?? []) {
    const path = `/evidenced_mistakes/${mistake.id}`;
    if (mistake.step_id && !stepIds.has(mistake.step_id)) {
      issue(path + "/step_id", "UNKNOWN_STEP", "易错点指向的步骤未在候选解答中定义。");
    }
    markdown(path + "/description_md", mistake.description_md, 16384);
    evidence(path, mistake.evidence);
  }
  for (const attempt of candidate.attempts ?? []) {
    const path = `/attempts/${attempt.external_id}`;
    if (context && !contextQuoteFor(attempt.original_work.markdown,
      attempt.original_work.evidence.filter(({ speaker }) => speaker === "learner"))) {
      issue(path + "/original_work", "CONTEXT_ATTEMPT_QUOTE_MISMATCH", "本人作答须有逐字对应的学习者引句，请核对发言归属和原话。");
    }
    markdown(path + "/original_work/markdown", attempt.original_work.markdown, 131072);
    evidence(path + "/original_work", attempt.original_work.evidence);
    if (attempt.outcome_evidence) evidence(path + "/outcome", attempt.outcome_evidence);
    text(path + "/error_analysis", attempt.error_analysis, 131072);
    text(path + "/correction", attempt.correction, 131072);
    text(path + "/insight", attempt.insight, 131072);
  }
  return finish();
}

export function inspectTopicCandidate(candidate: TopicImportCandidate, sources: ImportSource[], namespace?: string) {
  const { issue, evidence, markdown, text, unique, finish } = evidenceInspector(candidate, sources, namespace);
  unique("/sections", (candidate.sections ?? []).map(({ id }) => id));
  unique("/learner_questions", (candidate.learner_questions ?? []).map(({ id }) => id));
  unique("/evidenced_mistakes", (candidate.evidenced_mistakes ?? []).map(({ id }) => id));
  text("/summary", candidate.summary, 8192);
  markdown("/ai_notes_md", candidate.ai_notes_md, 131072);
  for (const section of candidate.sections ?? []) {
    const path = `/sections/${section.id}`;
    markdown(path + "/title", section.title, 512);
    text(path + "/content", section.content, 32768);
  }
  for (const question of candidate.learner_questions ?? []) {
    const path = `/learner_questions/${question.id}`;
    markdown(path + "/question_md", question.question_md, 16384);
    evidence(path, question.evidence);
  }
  for (const mistake of candidate.evidenced_mistakes ?? []) {
    const path = `/evidenced_mistakes/${mistake.id}`;
    markdown(path + "/description_md", mistake.description_md, 16384);
    evidence(path, mistake.evidence);
  }
  for (const gap of candidate.gaps ?? []) {
    const affectsSource = namespace === contextImportNamespace && /^\/(?:source_keys|sources)(?:\/|$)/.test(gap.field_path);
    issue(gap.field_path, "DECLARED_GAP", gap.note, gap.status === "needs_verification" || affectsSource ? "blocking" : "notice");
  }
  return finish();
}

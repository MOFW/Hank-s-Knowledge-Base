import { reviewChecks, sourceWitness, type AiReport, type SourceWitness } from "@/domain/ai-review";
import type { BatchRow, ItemRow } from "@/db/queries/imports";
import type { ImportPlan } from "@/services/import-plan";
import { isTopicCandidate, type ImportCandidate, type ImportText, type Evidence } from "@/domain/imports";

export function witnessFor(batch: BatchRow, item: ItemRow): SourceWitness | undefined {
  const candidate = item.candidateJson;
  if (isTopicCandidate(candidate) || candidate.statement?.origin !== "quoted" ||
      candidate.statement.evidence?.length !== 1 || candidate.source_keys?.length !== 1) return;
  const [entry] = candidate.statement.evidence;
  if (entry.quote !== candidate.statement.markdown || entry.source_key !== candidate.source_keys[0] ||
      !["learner", "source_author"].includes(entry.speaker)) return;
  const source = batch.sourceJson.find(({ source_key }) => source_key === entry.source_key);
  if (!source || source.acquisition_status === "unavailable") return;
  const witness = sourceWitness.safeParse({ title: source.title, locator: entry.locator, quote: entry.quote });
  return witness.success ? witness.data : undefined;
}

export function hasVisual(candidate: ItemRow["candidateJson"]) {
  const question = !isTopicCandidate(candidate) && candidate;
  return Boolean((question && (question.original_asset_ids?.length || question.history_images?.length)) ||
    JSON.stringify(candidate).match(/!\[|<img\b|\/(?:original_asset_ids|history_images)|原图|如图|下图|见图|figure|diagram/i));
}
const redact = (value?: string) => value?.replace(
  /https?:\/\/[^\s<>()]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b1[3-9]\d{9}\b/gi, "[已省略联系信息或链接]");
const refs = (entries?: Evidence[]) => entries?.map(({ quote, speaker, source_key }) => ({ source_key, speaker, quote: redact(quote) }));
const excerpt = (value?: ImportText) => value && { markdown: redact(value.markdown), origin: value.origin, evidence: refs(value.evidence) };
const note = (value: NonNullable<NonNullable<ImportCandidate["solution_document"]>["annotations"]>[number]) => ({
  id: value.id, label: redact(value.label), basis: excerpt(value.basis), strategy: excerpt(value.strategy), explanation: excerpt(value.explanation),
  ai_explanation_md: redact(value.ai_explanation_md), common_mistakes: excerpt(value.common_mistakes),
});

export function reviewMaterial(batch: BatchRow, item: ItemRow, plan: ImportPlan, trusted: boolean, classification: object) {
  const candidate = item.candidateJson;
  const shared = {
    title: redact(candidate.title), operation: candidate.operation, classification,
    source_verification: trusted ? "owner_verified_exact_statement" : "unverified",
    sources: batch.sourceJson.filter(({ source_key }) => candidate.source_keys?.includes(source_key))
      .map(({ kind, acquisition_status, source_key }) => ({ kind, acquisition_status, source_key })),
    gaps: candidate.gaps?.map(({ field_path, status, note }) => ({ field_path, status, note: redact(note) })),
    learner_questions: candidate.learner_questions?.map(({ id, question_md, evidence, ...extra }) => ({
      id, question_md: redact(question_md), evidence: refs(evidence), ...("annotation_id" in extra ? { annotation_id: extra.annotation_id } : {}),
    })),
    evidenced_mistakes: candidate.evidenced_mistakes?.map(({ id, description_md, evidence, ...extra }) => ({
      id, kind: "kind" in extra ? extra.kind : undefined, description_md: redact(description_md),
      evidence: refs(evidence), ...("step_id" in extra ? { step_id: extra.step_id } : {}),
    })),
    visual: hasVisual(candidate) ? "unknown_image_not_sent" : "no_image_supplied",
    flags: plan.issues.map(({ path, code }) => ({ path, code })),
    duplicate_matches: plan.duplicates.map(({ title, reason, excerpt }) => ({ title: redact(title), reason, excerpt: redact(excerpt) })),
  };
  if (isTopicCandidate(candidate)) return {
    ...shared, summary: excerpt(candidate.summary),
    sections: candidate.sections?.map(({ id, kind, title, content }) => ({ id, kind, title: redact(title), content: excerpt(content) })),
  };
  return {
    ...shared, statement: excerpt(candidate.statement), final_answer: excerpt(candidate.final_answer), key_techniques: excerpt(candidate.key_techniques),
    solution_document: candidate.solution_document && {
      body: excerpt(candidate.solution_document.body), annotations: candidate.solution_document.annotations?.map(note),
      step_anchor_ids: candidate.solution_document.step_anchor_ids,
    },
    solution_steps: candidate.solution_steps?.map((step) => ({ ...note(step), title: redact(step.title), body: excerpt(step.body) })),
  };
}

export function arithmeticKey(statement?: string) {
  const match = /^计算[：: ]*\$?(-?\d{1,5}) *([+\-×*]) *(-?\d{1,5})\$?[。？?]?$/.exec(statement ?? "");
  if (!match) return;
  const [, a, op, b] = match;
  const operation = op === "×" ? "*" : op;
  const x = Number(a);
  const y = Number(b);
  const answer = operation === "+" ? x + y : operation === "-" ? x - y : x * y;
  const operands = operation === "-" ? [x, y] : [Math.min(x, y), Math.max(x, y)];
  return { statement: match[0], x, y, operation, answer, key: operands.join(operation) };
}

export function independentlySolved(candidate: ImportCandidate) {
  const arithmetic = arithmeticKey(candidate.statement?.markdown);
  if (!arithmetic) return false;
  const { x, y, operation, answer } = arithmetic;
  const normalize = (value?: string) => value?.trim().replace(/^[\s$]+|[\s$]+$/g, "").replaceAll(" ", "").replaceAll("×", "*");
  const body = candidate.solution_document?.body ?? candidate.solution_steps?.[0]?.body;
  const extraStepContent = candidate.solution_steps?.some((step) =>
    step.basis || step.strategy || step.explanation || step.ai_explanation_md || step.topic_refs?.length);
  return (!candidate.final_answer || normalize(candidate.final_answer.markdown) === String(answer)) &&
    normalize(body?.markdown) === String(x) + operation + String(y) + "=" + String(answer) &&
    !candidate.key_techniques && !candidate.ai_notes_md && !candidate.attempts?.length && !candidate.evidenced_mistakes?.length &&
    !candidate.learner_questions?.length && !candidate.solution_document?.annotations?.length &&
    !candidate.solution_document?.step_anchor_ids?.length && !extraStepContent && (candidate.solution_steps?.length ?? 0) <= 1 &&
    !(candidate.solution_document && candidate.solution_steps?.length) &&
    ![candidate.final_answer, body].some((field) => field && (field.evidence?.length || field.origin !== "ai_generated"));
}

export function modelReasons(report: AiReport, visual: boolean) {
  const missing = new Set(visual ? ["annotations", "follow_ups"] : ["annotations", "follow_ups", "visual"]);
  return [
    ...(report.decision !== "pass" || report.risk_level !== "low" || report.issues.length || report.suggested_corrections.length
      ? ["MODEL_REVIEW_REQUIRED"] : []),
    ...reviewChecks.filter((key) => report.checks[key] !== "pass" && !(missing.has(key) && report.checks[key] === "not_applicable"))
      .map((key) => "CHECK_" + key),
  ];
}

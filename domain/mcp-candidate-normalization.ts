import { canonicalAnnotationIds } from "@/lib/solution-anchors";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  if (Array.isArray(value) && value.length === 1 && object(value[0])) value = value[0];
  if (object(value) && value.origin === "ai_generated" && Array.isArray(value.evidence) && value.evidence.length === 0) {
    const text = { ...value };
    delete text.evidence;
    return text;
  }
  return value;
}

// This adapter only changes shape. Provenance, quoted text and missing evidence stay explicit.
export function normalizeTaskCandidate(candidate: Record<string, unknown>) {
  const normalized = { ...candidate };
  const document = candidate.solution_document;
  let renamed = new Map<string, string>();
  if (object(document)) {
    const body = normalizeText(document.body);
    const annotations = document.annotations;
    const ids = Array.isArray(annotations) ? annotations.flatMap((entry) => object(entry) && typeof entry.id === "string" ? [entry.id] : []) : [];
    if (object(body) && typeof body.markdown === "string" && ids.some((id) => id.startsWith("hkb-"))) {
      renamed = canonicalAnnotationIds(body.markdown, ids);
    }
    normalized.solution_document = {
      ...document, body,
      ...(renamed.size && Array.isArray(annotations) ? {
        annotations: annotations.map((entry) => object(entry) && typeof entry.id === "string" && renamed.has(entry.id)
          ? { ...entry, id: renamed.get(entry.id) } : entry),
      } : {}),
    };
  }
  if (Object.hasOwn(candidate, "key_techniques")) normalized.key_techniques = normalizeText(candidate.key_techniques);
  if (Array.isArray(candidate.learner_questions)) {
    normalized.learner_questions = candidate.learner_questions.map((entry) => {
      if (!object(entry)) return entry;
      const result = { ...entry };
      const question = entry.question_md;
      if (object(question) && Object.keys(question).length === 1 && typeof question.markdown === "string") {
        result.question_md = question.markdown;
      }
      if (typeof entry.annotation_id === "string" && renamed.has(entry.annotation_id)) {
        result.annotation_id = renamed.get(entry.annotation_id);
      }
      return result;
    });
  }
  return normalized;
}

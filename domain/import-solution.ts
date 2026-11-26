import { contextImportNamespace } from "@/domain/context-reference";
import { historyImportNamespace } from "@/domain/history-reference";
import type { ImportCandidate, ImportText, TopicRef } from "@/domain/imports";
import type { SolutionAnnotation, SolutionDocument } from "@/domain/solution";

export const sourcedNoteFields = [
  ["basis", "basisMd", "推导依据"], ["strategy", "strategyMd", "思路来源"],
  ["explanation", "explanationMd", "解释"], ["common_mistakes", "commonMistakesMd", "易错点"],
] as const;

export function importTextKind(text: ImportText) {
  if (text.origin === "ai_generated") return "ai_generated";
  return text.evidence?.length && text.evidence.every(({ speaker }) => speaker === "assistant") ? "assistant" : "source";
}

export const importTextLabels = {
  assistant: "来自原助手", source: "有来源", ai_generated: "AI 补充",
};

export function layersImportQuestions(namespace: string) {
  return namespace === contextImportNamespace || namespace === historyImportNamespace;
}

// The candidate keeps original quotes and role/locator evidence. The formal
// document keeps the teaching text and attribution alongside the stable anchor.
// Both the writer and the candidate reader use the same projection.
export function projectImportSolution(candidate: ImportCandidate, layerQuestions: boolean,
  mapTopics: (refs: TopicRef[] | undefined, path: string) => string[],
): SolutionDocument | undefined {
  const doc = candidate.solution_document;
  if (!doc) return undefined;
  const annotations = (doc.annotations ?? []).map((note): SolutionAnnotation => {
    const noteOrigins: NonNullable<SolutionAnnotation["noteOrigins"]> = {};
    for (const [key, field] of sourcedNoteFields) {
      const text = note[key];
      if (text) noteOrigins[field] = importTextKind(text);
    }
    const learnerQuestionsMd = layerQuestions ? [...new Set((candidate.learner_questions ?? [])
      .filter(({ annotation_id }) => annotation_id === note.id).map(({ question_md }) => question_md))] : [];
    return {
      id: note.id, label: note.label,
      basisMd: note.basis?.markdown ?? "", strategyMd: note.strategy?.markdown ?? "",
      explanationMd: note.explanation?.markdown ?? "", aiExplanationMd: note.ai_explanation_md ?? "",
      commonMistakesMd: note.common_mistakes?.markdown ?? "",
      topicIds: mapTopics(note.topic_refs, `/solution_document/annotations/${note.id}`),
      ...(learnerQuestionsMd.length ? { learnerQuestionsMd } : {}),
      ...(layerQuestions && Object.keys(noteOrigins).length ? { noteOrigins } : {}),
    };
  });
  return { bodyMd: doc.body.markdown, annotations, stepAnchorIds: doc.step_anchor_ids };
}

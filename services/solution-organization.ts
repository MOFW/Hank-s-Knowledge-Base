import type { LearningMaterialIssue, OrganizedSolution, SolutionFollowUp, SolutionOrganization } from "@/domain/learning-organization";
import { Problem } from "@/domain/problem";
import type { NewQuestion, QuestionPatch } from "@/domain/questions";
import type { SolutionDocument } from "@/domain/solution";
import type { SolutionLayers, SolutionThread, TeachingText } from "@/domain/solution-layers";
import { exportSolutionMarkdown, insertSolutionMarker, solutionAnchorIds, solutionAnchorSummaries, solutionAnnotationPositions, solutionTextPosition } from "@/lib/solution-anchors";

type QuestionSolution = Pick<NewQuestion, "solutionDocument" | "solutionLayers" | "solutionSteps" | "finalAnswerMd">;
const emptyLayers = (): SolutionLayers => ({ mainThreads: [], alternatives: [], supplements: [] });
const normalize = (value: string) => value.trim().replace(/\s+/gu, " ");

export function requireLearningMaterial(issue?: LearningMaterialIssue) {
  if (!issue) return;
  const [code, message] = {
    missing_statement: ["STATEMENT_REQUIRED", "缺少必要题干，请补充可核对的原题。"],
    missing_image: ["MISSING_ORIGINAL_IMAGE", "缺少必要原图，请补充实际文件。"],
    unidentified: ["UNIDENTIFIED_MATERIAL", "无法确定该片段对应的题目。"],
    uncertain_math: ["UNCERTAIN_MATH", "关键推导仍待核对，请先解决数学疑点。"],
  }[issue.kind];
  throw new Problem(422, code, issue.detail ? `${message} ${issue.detail}` : message, { kind: issue.kind });
}

function nextId(prefix: string, existing: Iterable<string>) {
  const used = new Set(existing);
  let index = 1;
  while (used.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

function generated(markdown: string): TeachingText {
  return { markdown, origin: "ai_generated", speaker: "new_ai" };
}

function answerText(input: Pick<SolutionFollowUp, "answer" | "answerEvidence" | "answerFrom">): TeachingText {
  if (input.answerFrom === "discussion") {
    return { markdown: input.answer, origin: "source_summary", speaker: "assistant",
      ...(input.answerEvidence ? { evidence: input.answerEvidence } : {}) };
  }
  if (input.answerEvidence) {
    throw new Problem(422, "INVALID_SOURCE_ROLE", "原助手的证据须与来自原对话的解释一起提交。");
  }
  return generated(input.answer);
}

type Location = SolutionFollowUp["at"];
function locate(markdown: string, threads: SolutionThread[], at: Location, create: boolean) {
  if (typeof at !== "string") {
    if (!solutionAnnotationPositions(markdown).has(at.anchorId)) {
      throw new Problem(422, "SOLUTION_POSITION_NOT_FOUND", "该锚点在所选解法中不存在、重复或失效。", { anchorId: at.anchorId });
    }
    return { markdown, anchorId: at.anchorId };
  }
  const position = solutionTextPosition(markdown, at);
  if (position.status === "ambiguous") {
    throw new Problem(422, "AMBIGUOUS_SOLUTION_POSITION", "该片段在所选解法中重复，请提供更具体的原文或已确认的锚点。", { at });
  }
  if (position.status !== "found") {
    throw new Problem(422, "SOLUTION_POSITION_NOT_FOUND", "在所选解法中找不到可挂载的片段。请核对正文或公式。", { at });
  }
  const existing = position.anchors.filter((id) => threads.some(({ anchorId }) => anchorId === id));
  if (existing.length > 1) {
    throw new Problem(422, "AMBIGUOUS_SOLUTION_POSITION", "该位置有多个旧追问锚点，请选择已确认的锚点。", { anchors: existing });
  }
  const anchorId = existing[0] ?? position.anchors[0];
  if (anchorId) return { markdown, anchorId };
  if (!create) throw new Problem(404, "FOLLOW_UP_NOT_FOUND", "定位成功，此处还没有可修订的追问。");
  const id = nextId("discussion", solutionAnchorIds(markdown));
  return { markdown: insertSolutionMarker(markdown, position, id), anchorId: id };
}

function appendFollowUp(markdown: string, threads: SolutionThread[], input: SolutionFollowUp) {
  const placed = locate(markdown, threads, input.at, true);
  let thread = threads.find(({ anchorId }) => anchorId === placed.anchorId);
  if (!thread) {
    thread = { anchorId: placed.anchorId, turns: [] };
    threads.push(thread);
  }
  const learner: TeachingText = {
    markdown: input.question, origin: "source_summary", speaker: "learner",
    ...(input.questionEvidence ? { evidence: input.questionEvidence } : {}),
  };
  const reply = answerText(input);
  const duplicate = thread.turns.find((turn) => normalize(turn.learner.markdown) === normalize(learner.markdown));
  if (duplicate) {
    if (!duplicate.replies.some((existing) => normalize(existing.markdown) === normalize(reply.markdown))) {
      throw new Problem(409, "FOLLOW_UP_EXISTS", "此处已有同一追问。请定位原问答并明确修订解释。", { turnId: duplicate.id });
    }
    return placed.markdown;
  }
  thread.turns.push({ id: nextId("turn", thread.turns.map(({ id }) => id)), learner, replies: [reply] });
  return placed.markdown;
}

function addAlternatives(layers: SolutionLayers, alternatives: NonNullable<SolutionOrganization["alternatives"]>) {
  for (const input of alternatives) {
    const matches = layers.alternatives.filter(({ title }) => normalize(title) === normalize(input.title));
    if (matches.length > 1) throw new Problem(409, "AMBIGUOUS_METHOD", "已有多个同名解法，请先确认要补充的解法。");
    let alternative = matches[0];
    if (alternative) {
      if (normalize(exportSolutionMarkdown(alternative.body.markdown)) !== normalize(input.markdown)) {
        throw new Problem(409, "METHOD_EXISTS", "同名解法的正文不同，请另起明确的方法名或编辑已有解法。", { methodId: alternative.id });
      }
    } else {
      alternative = { id: nextId("method", layers.alternatives.map(({ id }) => id)), title: input.title,
        body: generated(input.markdown), threads: [] };
      layers.alternatives.push(alternative);
    }
    for (const followUp of input.followUps ?? []) {
      alternative.body.markdown = appendFollowUp(alternative.body.markdown, alternative.threads, followUp);
    }
  }
}

export function createOrganizedSolution(input: OrganizedSolution): Pick<NewQuestion, "solutionDocument" | "solutionLayers"> {
  const document = { bodyMd: input.main, annotations: [] };
  const patch = organizeSolution({ solutionDocument: document, solutionLayers: null, solutionSteps: [], finalAnswerMd: "" }, input);
  return { solutionDocument: patch.solutionDocument ?? document, solutionLayers: patch.solutionLayers ?? null };
}

export function organizeSolution(current: QuestionSolution, input: SolutionOrganization): QuestionPatch {
  const layers = structuredClone(current.solutionLayers ?? emptyLayers());
  let document = current.solutionDocument;
  let changedMain = false;
  addAlternatives(layers, input.alternatives ?? []);
  for (const followUp of input.followUps ?? []) {
    const target = methodTarget(followUp.method);
    const markdown = appendFollowUp(target.markdown, target.threads, followUp);
    if (target.alternative) target.alternative.body.markdown = markdown;
    else if (markdown !== document?.bodyMd) {
      document = { ...document, bodyMd: markdown, annotations: document?.annotations ?? [] };
      changedMain = true;
    }
  }
  for (const correction of input.corrections ?? []) {
    const target = methodTarget(correction.method);
    const { anchorId } = locate(target.markdown, target.threads, correction.at, false);
    const thread = target.threads.find((thread) => thread.anchorId === anchorId);
    const turns = (thread?.turns ?? []).filter(({ id, learner }) =>
      (correction.turnId === undefined || correction.turnId === id)
      && (correction.question === undefined || normalize(learner.markdown) === normalize(correction.question)));
    if (!turns.length) throw new Problem(404, "FOLLOW_UP_NOT_FOUND", "找不到指定追问，请核对问题原文或轮次。");
    if (turns.length > 1) throw new Problem(422, "AMBIGUOUS_FOLLOW_UP", "该位置有多轮问答，请指定问题原文或轮次。");
    const turn = turns[0];
    if (correction.reply === undefined && turn.replies.length > 1) {
      throw new Problem(422, "AMBIGUOUS_REPLY", "该问答有多条回复，请指定第几条。");
    }
    const index = (correction.reply ?? 1) - 1;
    if (index >= turn.replies.length) throw new Problem(404, "FOLLOW_UP_NOT_FOUND", "找不到指定的回复次序。");
    turn.replies[index] = answerText(correction);
  }
  if (input.summary && !layers.supplements.some(({ body }) => normalize(body.markdown) === normalize(input.summary!))) {
    layers.supplements.push({ id: nextId("summary", layers.supplements.map(({ id }) => id)),
      kind: "method_summary", title: "方法总结", body: generated(input.summary) });
  }
  const hasLayers = layers.mainThreads.length || layers.alternatives.length || layers.supplements.length;
  return { ...(changedMain ? { solutionDocument: document } : {}), solutionLayers: hasLayers ? layers : current.solutionLayers };

  function methodTarget(method?: string): {
    markdown: string; threads: SolutionThread[]; alternative?: SolutionLayers["alternatives"][number];
  } {
    if (!method) {
      if (document) return { markdown: document.bodyMd, threads: layers.mainThreads };
      if (!current.solutionSteps.length && current.finalAnswerMd.trim()) {
        return { markdown: current.finalAnswerMd, threads: layers.mainThreads };
      }
      throw new Problem(422, "UNSUPPORTED_SOLUTION_LAYOUT", "主解尚无可定位的连续正文。旧分步解答可继续使用原编辑方式。");
    }
    const byId = layers.alternatives.find(({ id }) => id === method);
    const matches = byId ? [byId] : layers.alternatives.filter(({ title }) => normalize(title) === normalize(method));
    if (matches.length !== 1) {
      throw new Problem(matches.length ? 422 : 404, matches.length ? "AMBIGUOUS_METHOD" : "METHOD_NOT_FOUND",
        matches.length ? "解法名称重复，请指定查询返回的解法标识。" : "找不到所选解法。", { method });
    }
    const alternative = matches[0];
    return { markdown: alternative.body.markdown, threads: alternative.threads, alternative };
  }
}

export function solutionIndex(document: SolutionDocument | null, finalAnswerMd: string, layers: SolutionLayers | null) {
  const method = (id: string | null, title: string, body: string, threads: SolutionThread[]) => {
    const placements = solutionAnchorSummaries(body).map(({ anchorId, line, text }) => ({
      anchorId, line, text,
      turns: (threads.find((thread) => thread.anchorId === anchorId)?.turns ?? []).map(({ id, learner, replies }) =>
        ({ id, question: learner.markdown.slice(0, 180), replies: replies.length })),
    }));
    return { id, title, placements };
  };
  return [method(null, "主解答", document?.bodyMd ?? finalAnswerMd, layers?.mainThreads ?? []),
    ...layers?.alternatives.map(({ id, title, body, threads }) => method(id, title, body.markdown, threads)) ?? []];
}

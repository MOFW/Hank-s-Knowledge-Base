import * as store from "@/db/queries/imports";
import { newTopic } from "@/domain/catalog";
import { inspectTopicCandidate } from "@/domain/import-evidence";
import { importDigest, pointer, type CourseRef, type TopicRef } from "@/domain/imports";
import { mergeTopicNote } from "@/services/topic-note-merge";

type Catalog = Awaited<ReturnType<typeof store.importCatalog>>;
type TopicChoice = Catalog[1][number];
type Directory = {
  courses: Catalog[0];
  topics: TopicChoice[];
  chapters: Catalog[2];
  chapterPath: (id: string | null) => string[];
  courseMatches: (ref?: CourseRef | null) => string[];
  topicMatches: (ref: TopicRef) => string[];
  dataEpoch?: number;
};

const labelKey = (name: string) => name.trim().normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
const compactKey = (name: string) => labelKey(name).replace(/[\p{P}\p{Z}]+/gu, "");

function similarTitle(title: string, other: string) {
  const a = compactKey(title);
  const b = compactKey(other);
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)))) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const lengthDifference = longer.length - shorter.length;
  if (shorter.length < 4 || lengthDifference > 1) return false;
  let mismatch = 0;
  while (mismatch < shorter.length && shorter[mismatch] === longer[mismatch]) mismatch++;
  if (mismatch === shorter.length) return lengthDifference === 1;
  return shorter.slice(mismatch + (lengthDifference ? 0 : 1)) === longer.slice(mismatch + 1);
}

export async function planTopicImports(batch: store.BatchRow, items: store.TopicItem[], siblings: store.ItemRow[], directory: Directory) {
  if (!items.length) return [];
  const byItemKey = new Map(siblings.map((item) => [item.itemKey, item]));
  const questionIds = items.flatMap(({ candidateJson }) => (candidateJson.related_question_refs ?? []).flatMap((ref) => {
    const id = "id" in ref ? ref.id : byItemKey.get(ref.item_key)?.questionId;
    return id ? [id] : [];
  }));
  const [targetRows, questionRows, externalRows] = await store.topicImportRecords(batch.ownerId, batch.namespace, items, questionIds);
  const targets = new Map(targetRows.map(({ topic }) => [topic.id, topic]));
  const questions = new Map(questionRows.map((question) => [question.id, question]));
  const external = new Map(externalRows.map((row) => [row.externalId, row]));
  const topicById = new Map(directory.topics.map((topic) => [topic.id, topic]));

  return Promise.all(items.map(async (item) => {
    const { candidateJson: candidate, mappingJson: mapping } = item;
    const { issues, groups } = inspectTopicCandidate(candidate, batch.sourceJson, batch.namespace);
    const issue = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "blocking" });
    const target = mapping.topicTarget ?? (candidate.operation === "propose_update"
      ? { topicId: candidate.target_id, expectedVersion: candidate.expected_version } : undefined);
    const previous = target ? targets.get(target.topicId) : undefined;
    if (target && previous?.rowVersion !== target.expectedVersion) {
      issue("/target_id", "TARGET_CONFLICT", previous ? `笔记已变更为版本 ${previous.rowVersion}，请重新核对。` : "目标知识点已不可用。");
    }
    if (mapping.target) issue("/mapping", "INVALID_MAPPING", "知识点候选不能使用题目更新映射。");
    const courseCandidates = directory.courseMatches(candidate.course_ref);
    const courseId = mapping.courseId ?? (courseCandidates.length === 1 ? courseCandidates[0] : undefined)
      ?? (!candidate.course_ref ? previous?.courseId : undefined);
    if (courseId === undefined || (courseId !== null && !directory.courses.some(({ id }) => id === courseId))) {
      issue("/course_ref", courseCandidates.length > 1 ? "AMBIGUOUS_COURSE" : "UNRESOLVED_COURSE", "请选择一个可用的课程。");
    }
    if (previous && courseId !== previous.courseId) issue("/target_id", "TARGET_COURSE_MISMATCH", "补充目标必须属于所选课程。");
    if (previous && !mapping.topicTarget && candidate.title && labelKey(candidate.title) !== labelKey(previous.title)
      && labelKey(candidate.title) !== labelKey(previous.slug)) {
      issue("/target_id", "TARGET_TITLE_MISMATCH", "目标知识点的名称与候选不同，请核对并明确选择补充目标。");
    }

    const path = candidate.chapter_path?.map(labelKey);
    const matchingChapters = path?.length ? directory.chapters.filter((chapter) => chapter.courseId === courseId
      && directory.chapterPath(chapter.id).map(labelKey).join("\u0000") === path.join("\u0000")) : [];
    const chapterId = previous ? previous.chapterId
      : mapping.chapterId !== undefined ? mapping.chapterId
        : !path?.length ? null : matchingChapters.length === 1 ? matchingChapters[0].id : undefined;
    if (chapterId === undefined || (chapterId !== null && !directory.chapters.some((chapter) =>
      chapter.id === chapterId && chapter.courseId === courseId && directory.chapterPath(chapter.id).length))) {
      issue("/chapter_path", "UNRESOLVED_CHAPTER", "请选择所选课程中可用的章节，或明确选择未分类。");
    }
    if (previous && candidate.operation === "propose_update" && !mapping.topicTarget && path !== undefined
      && (path.length ? !matchingChapters.some(({ id }) => id === previous.chapterId) : previous.chapterId !== null)) {
      issue("/chapter_path", "TARGET_CHAPTER_MISMATCH", "目标知识点的章节与候选归属不同，请重新确认目标。");
    }

    const title = previous?.title ?? candidate.title?.trim() ?? "";
    const exact = title ? directory.topics.filter((topic) => topic.courseId === courseId && topic.id !== target?.topicId
      && labelKey(topic.title) === labelKey(title)) : [];
    const nameMatches = target || !title ? [] : [
      ...exact,
      ...directory.topics.filter((topic) => topic.courseId === courseId
        && labelKey(topic.title) !== labelKey(title) && similarTitle(title, topic.title)).slice(0, 8),
    ];
    if (!target && exact.some((topic) => (mapping.chapterId === undefined && !path?.length) || topic.chapterId === chapterId)) {
      issue("/title", "DUPLICATE_TOPIC", "所选课程已有同名知识点，请核对后补充已有笔记、修改名称或跳过。");
    }
    const duplicates: store.Duplicate[] = nameMatches.map((topic) => ({
      id: topic.id, title: topic.title, version: topic.rowVersion, courseId: topic.courseId,
      reason: labelKey(topic.title) === labelKey(title) ? "topic_title" : "topic_similar", excerpt: topic.chapterId
        ? directory.chapterPath(topic.chapterId).join(" / ") : "未分类",
    }));
    const registered = external.get(item.externalId);
    if (registered && registered.id !== target?.topicId) {
      issue("/external_id", "EXTERNAL_ID_CONFLICT", "此外部标识已登记，请核对已有知识点。");
      if (!duplicates.some(({ id }) => id === registered.id)) {
        duplicates.unshift({ ...registered, reason: "external_id", excerpt: "" });
      }
    }
    if (!target && courseId && title) for (const sibling of siblings.filter(store.isTopicItem)) {
      if (sibling.id === item.id || ["committed", "skipped", "rejected"].includes(sibling.status)
        || sibling.candidateJson.operation !== "create" || sibling.mappingJson.topicTarget) continue;
      const otherTitle = sibling.candidateJson.title?.trim();
      const otherCourses = directory.courseMatches(sibling.candidateJson.course_ref);
      const otherCourseId = sibling.mappingJson.courseId ?? (otherCourses.length === 1 ? otherCourses[0] : undefined);
      if (otherCourseId === courseId && otherTitle && similarTitle(title, otherTitle)) {
        duplicates.push({ id: sibling.id, title: otherTitle, version: null, courseId, reason: "batch", excerpt: "" });
      }
    }

    const topicMappings: { path: string; ref: TopicRef; candidates: string[]; selected: string | null | undefined }[] = [];
    const relatedTopicIds = new Set<string>();
    for (const [index, ref] of (candidate.related_topic_refs ?? []).entries()) {
      const path = `/related_topic_refs/${index}`;
      const candidates = directory.topicMatches(ref);
      const override = mapping.topicIdsByPath?.[path];
      const selected = override === undefined && candidates.length === 1 ? candidates[0] : override;
      topicMappings.push({ path, ref, candidates, selected });
      if (selected === null) continue;
      if (!selected || !topicById.has(selected) || selected === target?.topicId) {
        issue(path, "UNRESOLVED_TOPIC", "请选择其他可用的知识点，或跳过此关联。");
      } else {
        relatedTopicIds.add(selected);
      }
    }
    const paths = new Set(topicMappings.map(({ path }) => path));
    for (const path of Object.keys(mapping.topicIdsByPath ?? {})) {
      if (!paths.has(path)) issue(path, "INVALID_MAPPING", "映射指向不存在的候选引用。");
    }
    const relatedTopics = [...relatedTopicIds].map((id) => ({ id, title: topicById.get(id)!.title }));
    const relatedQuestions: { id: string | null; title: string; itemKey?: string }[] = [];
    const dependencies: { itemKey: string; candidate: unknown; mapping: unknown }[] = [];
    for (const [index, ref] of (candidate.related_question_refs ?? []).entries()) {
      const path = `/related_question_refs/${index}`;
      if ("id" in ref) {
        const question = questions.get(ref.id);
        if (!question) issue(path, "UNRESOLVED_QUESTION", "关联题目已不可用，请修订候选。");
        else relatedQuestions.push(question);
        continue;
      }
      const sibling = byItemKey.get(ref.item_key);
      if (!sibling || !store.isQuestionItem(sibling) || ["skipped", "rejected", "conflict"].includes(sibling.status)) {
        issue(path, "UNRESOLVED_QUESTION", "请核对同批题目候选，或移除此关联。");
        continue;
      }
      const question = sibling.questionId ? questions.get(sibling.questionId) : undefined;
      if (sibling.status === "committed" && !question) {
        issue(path, "UNRESOLVED_QUESTION", "同批已提交的题目不可用，请修订候选。");
      }
      relatedQuestions.push({
        id: question?.id ?? null, title: question?.title ?? sibling.candidateJson.title ?? sibling.itemKey, itemKey: sibling.itemKey,
      });
      dependencies.push({ itemKey: sibling.itemKey, candidate: sibling.candidateJson, mapping: sibling.mappingJson });
    }
    const pendingQuestions = relatedQuestions.some(({ id }) => !id);
    const bodyMd = mergeTopicNote(previous?.bodyMd ?? "", candidate);
    const summaryMd = previous?.summaryMd.trim() ? previous.summaryMd : candidate.summary?.markdown ?? previous?.summaryMd ?? "";
    const proposal = newTopic.safeParse({
      courseId, chapterId, title, bodyMd, summaryMd, slug: previous?.slug, sortOrder: previous?.sortOrder,
    });
    if (!proposal.success) for (const error of proposal.error.issues) {
      if (error.path[0] !== "courseId" && error.path[0] !== "chapterId") issue(pointer(error.path), "INVALID_CONTENT", error.message);
    }
    if (!previous && !bodyMd.trim() && !summaryMd.trim() && !candidate.ai_notes_md?.trim()
      && !candidate.learner_questions?.length && !candidate.evidenced_mistakes?.length) {
      issue("/sections", "NOTE_CONTENT_REQUIRED", "请提供至少一项可审核的笔记内容。");
    }
    const input = proposal.success && chapterId !== undefined && (!target || previous) ? proposal.data : undefined;
    const planHash = await importDigest({
      candidate, mapping, input, target, relatedTopics, dependencies,
      questions: relatedQuestions.filter(({ itemKey }) => !itemKey).map(({ id }) => id),
      duplicates: duplicates.filter(({ reason }) => reason !== "batch"),
    });
    const current = previous && { id: previous.id, title: previous.title, rowVersion: previous.rowVersion,
      summaryMd: previous.summaryMd, bodyMd: previous.bodyMd };
    const preview = input && (!target || target.expectedVersion === current?.rowVersion) ? { bodyMd, summaryMd } : undefined;
    return {
      kind: "topic" as const, item, input, previous, issues, groups, duplicates, courseCandidates, courseId,
      topicMappings, planHash, pendingQuestions, dataEpoch: directory.dataEpoch,
      topicPlan: { target, current, preview, chapterId, relatedTopics, relatedQuestions },
    };
  }));
}

export type TopicImportPlan = Awaited<ReturnType<typeof planTopicImports>>[number];

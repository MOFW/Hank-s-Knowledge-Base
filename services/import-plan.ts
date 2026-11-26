import { getAssetStore } from "@/adapters/assets";
import * as store from "@/db/queries/imports";
import { questionImportTargets } from "@/db/queries/questions";
import { contextImportNamespace, contextQuoteFor } from "@/domain/context-reference";
import { inspectCandidate } from "@/domain/import-evidence";
import { layersImportQuestions, projectImportSolution } from "@/domain/import-solution";
import { canonicalJson, importDigest, pointer, type CourseRef, type TopicRef } from "@/domain/imports";
import { newAttempt, newQuestion, type NewQuestion } from "@/domain/questions";
import { statementFingerprint } from "@/services/questions";
import { planTopicImports } from "@/services/topic-import-plan";

type FieldChange = { field: keyof NewQuestion; before: unknown; after: unknown; preserved: boolean };

const labelKey = (value: string) => value.trim().normalize("NFC").toLowerCase();

export async function planImports(batch: store.BatchRow, items: store.ItemRow[], siblings = items) {
  const [courseRows, topicRows, chapterRows, assetRows, externalRows, attemptRows, [state]] =
    await store.importCatalog(batch.ownerId, batch.namespace, items);
  const chapters = new Map(chapterRows.map((row) => [row.id, row]));
  const courses = new Map(courseRows.map((row) => [row.id, row]));
  function chapterPath(id: string | null): string[] {
    if (!id) return [];
    const path = [];
    for (let depth = 0; id && depth < 6; depth++) {
      const chapter = chapters.get(id);
      if (!chapter) return [];
      path.unshift(chapter.title);
      id = chapter.parentId;
    }
    return id ? [] : path;
  }
  const topicChoices = topicRows.map((topic) => ({
    ...topic, chapterPath: chapterPath(topic.chapterId), courseName: (topic.courseId ? courses.get(topic.courseId)?.name : null) ?? "未归类",
  }));
  const r2 = assetRows.length ? getAssetStore() : null;
  const assetChecks = await Promise.all(assetRows.map(async (asset) => {
    const object = await r2?.head(asset.storageKey);
    return { ...asset, ready: object?.size === asset.byteSize };
  }));
  const assets = new Map(assetChecks.map((asset) => [asset.id, asset]));
  const readyImages = new Map<string, (typeof assetChecks)[number]>();
  for (const asset of assetChecks) {
    const key = `${asset.sha256}:${asset.mimeType}:${asset.byteSize}`;
    if (asset.ready && !readyImages.has(key)) readyImages.set(key, asset);
  }
  const external = new Map(externalRows.map((row) => [row.externalId, row]));
  const attemptIds = new Set(attemptRows.map((row) => row.externalId));
  const questionItems = items.filter(store.isQuestionItem);
  const targetFor = (item: store.QuestionItem) => item.candidateJson.operation === "propose_update"
    ? item.mappingJson.target ?? { questionId: item.candidateJson.target_id, expectedVersion: item.candidateJson.expected_version }
    : undefined;
  const targets = [...new Set(questionItems.flatMap((item) => targetFor(item)?.questionId ?? []))];
  const current = await questionImportTargets(targets);
  function courseMatches(ref?: CourseRef | null) {
    if (!ref) return [];
    if ("id" in ref) return courses.has(ref.id) ? [ref.id] : [];
    const key = labelKey(ref.name);
    return courseRows.filter((course) => [course.name, course.slug].some((name) => labelKey(name) === key)).map(({ id }) => id);
  }
  function topicMatches(ref: TopicRef) {
    if ("id" in ref) return topicChoices.filter(({ id }) => id === ref.id).map(({ id }) => id);
    const ids = courseMatches(ref.course_ref);
    const title = labelKey(ref.title);
    return topicChoices.filter((topic) => topic.courseId !== null && ids.includes(topic.courseId)
      && [topic.title, topic.slug].some((name) => labelKey(name) === title)
      && (ref.chapter_path === undefined || canonicalJson(ref.chapter_path.map(labelKey)) === canonicalJson(topic.chapterPath.map(labelKey))))
      .map(({ id }) => id);
  }
  const topicPlans = planTopicImports(batch, items.filter(store.isTopicItem), siblings, {
    courses: courseRows, chapters: chapterRows, topics: topicChoices, chapterPath, courseMatches, topicMatches, dataEpoch: state?.dataEpoch,
  });
  const drafts = await Promise.all(questionItems.map(async (item) => {
    const { candidateJson: candidate, mappingJson: mapping } = item;
    const { issues, groups } = inspectCandidate(candidate, batch.sourceJson, batch.schemaVersion, batch.namespace);
    const issue = (path: string, code: string, message: string) => issues.push({ path, code, message, severity: "blocking" });
    if (mapping.topicTarget || mapping.chapterId !== undefined) issue("/mapping", "INVALID_MAPPING", "题目候选不能使用笔记映射。");
    const target = targetFor(item);
    const previous = target && current.get(target.questionId);
    if (target && (!previous || previous.rowVersion !== target.expectedVersion)) {
      issue("/target_id", "TARGET_CONFLICT", previous ? `目标已变更为版本 ${previous.rowVersion}，请重新核对。` : "目标题目已不可用。");
    }
    if (mapping.target && candidate.operation === "create") issue("/target", "INVALID_MAPPING", "新增候选不能映射为更新。");
    const externalMatch = external.get(item.externalId);
    if (externalMatch && (!target || externalMatch.questionId !== target.questionId)) {
      issue("/external_id", "EXTERNAL_ID_CONFLICT", "此外部标识已登记。请跳过，或修订为指向已登记题目的更新提案。");
    }
    const courseCandidates = courseMatches(candidate.primary_course_ref);
    const courseId = mapping.courseId ?? (courseCandidates.length === 1 ? courseCandidates[0] : undefined)
      ?? (!candidate.primary_course_ref ? previous?.primaryCourseId : undefined);
    if (courseId === undefined || (courseId !== null && !courses.has(courseId))) {
      issue("/primary_course_ref", courseCandidates.length > 1 ? "AMBIGUOUS_COURSE" : "UNRESOLVED_COURSE", "请选择一个可用的主课程。");
    }
    const topicMappings: { path: string; ref: TopicRef; candidates: string[]; selected: string | null | undefined }[] = [];
    function mapTopics(refs: TopicRef[] = [], path: string) {
      return refs.flatMap((ref, index) => {
        const at = `${path}/${index}`;
        const candidates = topicMatches(ref);
        const override = mapping.topicIdsByPath?.[at];
        const selected = override === undefined && candidates.length === 1 ? candidates[0] : override;
        topicMappings.push({ path: at, ref, candidates, selected });
        if (selected === null) return [];
        if (!selected || !topicChoices.some(({ id }) => id === selected)) {
          issue(at, candidates.length > 1 ? "AMBIGUOUS_TOPIC" : "UNRESOLVED_TOPIC", "请选择可用的知识点，或明确跳过此关联。");
          return [];
        }
        return [selected];
      });
    }
    const topicIds = [...new Set([...(previous?.topicIds ?? []), ...mapTopics(candidate.topic_refs, "/topic_refs")])];
    const originalAssetIds = new Set([...(previous?.originalAssetIds ?? []), ...(candidate.original_asset_ids ?? [])]);
    const assetFingerprints = [];
    for (const id of candidate.original_asset_ids ?? []) {
      const asset = assets.get(id);
      if (!asset?.ready) issue("/original_asset_ids", "INVALID_ASSET", `题图「${id}」不可用或原件缺失。`);
      else assetFingerprints.push(asset.sha256);
    }
    const historyImages = (candidate.history_images ?? []).map((image, index) => {
      const matches = (id: string) => {
        const asset = assets.get(id);
        return asset?.ready && asset.sha256 === image.sha256 && asset.mimeType === image.mime_type && asset.byteSize === image.byte_size;
      };
      const assetId = [...originalAssetIds].find(matches)
        ?? readyImages.get(`${image.sha256}:${image.mime_type}:${image.byte_size}`)?.id;
      if (assetId) {
        originalAssetIds.add(assetId);
        assetFingerprints.push(image.sha256);
      } else {
        issue(`/history_images/${index}`, "HISTORY_IMAGE_UNREGISTERED", "请核对原图并登记材料包中的原始图片。");
      }
      return { ...image, assetId };
    });
    const mapNoteTopics = (refs: TopicRef[] | undefined, path: string) => {
      const ids = [...new Set(mapTopics(refs, path + "/topic_refs"))];
      if (ids.some((id) => !topicIds.includes(id))) {
        issue(path + "/topic_refs", "UNLINKED_TOPIC", "步骤或注释的知识点须同时关联到题目。");
      }
      return ids;
    };
    const solutionSteps = candidate.solution_steps?.map((step) => ({
      id: step.id, basisMd: step.basis?.markdown, strategyMd: step.strategy?.markdown,
      explanationMd: step.explanation?.markdown, aiExplanationMd: step.ai_explanation_md,
      topicIds: mapNoteTopics(step.topic_refs, "/solution_steps/" + step.id), title: step.title, bodyMd: step.body.markdown,
      commonMistakesMd: candidate.evidenced_mistakes?.filter((note) => note.kind === "documented_pitfall" && note.step_id === step.id)
        .map(({ description_md }) => description_md).join("\n\n"),
    }));
    const solutionDocument = projectImportSolution(candidate, layersImportQuestions(batch.namespace), mapNoteTopics);
    const paths = new Set(topicMappings.map(({ path }) => path));
    for (const path of Object.keys(mapping.topicIdsByPath ?? {})) {
      if (!paths.has(path)) issue(path, "INVALID_MAPPING", "映射指向不存在的候选引用。");
    }
    const statement = candidate.statement;
    const context = batch.namespace === contextImportNamespace;
    const statementMatches = !previous?.statementMd.trim() || previous.statementMd === statement?.markdown;
    const statementCitation = context && statement?.origin === "quoted"
      ? contextQuoteFor(statement.markdown, statement.evidence) : statement?.evidence?.[0];
    const citation = statementMatches ? statementCitation ?? historyImages.find(({ assetId }) => assetId) : undefined;
    const sourceKey = citation?.source_key ?? (statementMatches ? candidate.source_keys?.[0] : undefined);
    const source = batch.sourceJson.find(({ source_key }) => source_key === sourceKey);
    const proposed = {
      primaryCourseId: courseId, title: candidate.title, statementMd: candidate.statement?.markdown,
      finalAnswerMd: candidate.final_answer?.markdown, keyTechniquesMd: candidate.key_techniques?.markdown,
      solutionSteps, solutionDocument, difficulty: candidate.difficulty,
      sourceDate: context && previous?.sourceTitle ? previous.sourceDate : candidate.source_date,
      topicIds, originalAssetIds: [...originalAssetIds],
      sourceTitle: source?.title,
      sourceLocator: citation?.locator,
    };
    const proposal = newQuestion.safeParse({
      ...(previous ? newQuestion.strip().parse(previous) : {}),
      ...Object.fromEntries(Object.entries(proposed).filter(([, value]) => value !== undefined)),
    });
    const changes: FieldChange[] = [];
    let input: NewQuestion | undefined;
    if (!proposal.success) {
      for (const error of proposal.error.issues) {
        if (error.path[0] !== "primaryCourseId" || courseId) issue(pointer(error.path), "INVALID_CONTENT", error.message);
      }
    } else {
      input = proposal.data;
      if (previous) {
        const next = { ...input };
        const before = newQuestion.strip().parse(previous);
        for (const key of Object.keys(before) as (keyof NewQuestion)[]) {
          if (canonicalJson(before[key]) === canonicalJson(next[key])) continue;
          const value = before[key];
          const additive = key === "topicIds" || key === "originalAssetIds";
          const existingContent = typeof value === "string" ? Boolean(value.trim()) : Array.isArray(value) ? value.length > 0 : value !== null;
          const preserveSource = (key === "sourceTitle" || key === "sourceLocator") && Boolean(before.sourceTitle);
          const preserveSolution = (key === "solutionDocument" || key === "solutionSteps")
            && Boolean(before.solutionDocument || before.solutionSteps.length || before.finalAnswerMd.trim());
          const preserved = (!additive && existingContent) || preserveSource || preserveSolution;
          changes.push({ field: key, before: value, after: next[key], preserved });
          if (preserved) Object.assign(next, { [key]: value });
        }
        input = next;
      }
    }
    const plannedAttempts = (candidate.attempts ?? []).flatMap((attempt) => {
      const path = `/attempts/${attempt.external_id}`;
      if (attemptIds.has(attempt.external_id)) issue(path, "ATTEMPT_ID_CONFLICT", "此作答的外部标识已登记。");
      const recordedError = candidate.evidenced_mistakes?.some((note) => note.kind === "observed_learner_error"
        && note.evidence.some((proof) => attempt.original_work.evidence.some((original) => canonicalJson(original) === canonicalJson(proof))));
      const correction = attempt.correction;
      const correctionSpeakers = correction?.evidence?.map(({ speaker }) => speaker) ?? [];
      const correctionAuthorKind = correction?.origin === "ai_generated"
        || (correctionSpeakers.length && correctionSpeakers.every((speaker) => speaker === "assistant")) ? "ai"
        : correctionSpeakers.length && correctionSpeakers.every((speaker) => speaker === "learner") ? "user" : "unknown";
      const parsed = newAttempt.safeParse({
        attemptedAt: attempt.attempted_at ?? null, originalWorkMd: attempt.original_work.markdown,
        errorAnalysisMd: recordedError && (attempt.error_analysis?.origin === "quoted" || attempt.error_analysis?.origin === "transcribed")
          ? attempt.error_analysis.markdown : null,
        correctionMd: correction?.markdown,
        correctionAuthorKind,
        insightMd: attempt.insight?.origin === "ai_generated" ? null : attempt.insight?.markdown,
        outcome: attempt.outcome,
      });
      if (!parsed.success) {
        for (const error of parsed.error.issues) issue(path + pointer(error.path), "INVALID_CONTENT", error.message);
        return [];
      }
      return [{ externalId: attempt.external_id, attemptedOn: attempt.attempted_on ?? null, input: parsed.data }];
    });
    const fingerprintStatement = (input?.statementMd ?? statement?.markdown ?? "").replace(/\r\n?/g, "\n").trim();
    const fingerprint = {
      statementHash: await statementFingerprint(fingerprintStatement), statement: fingerprintStatement, imageHashes: [...new Set(assetFingerprints)].sort(),
      title: input?.title ?? candidate.title?.trim() ?? "", courseId: input?.primaryCourseId ?? courseId ?? null,
    };
    return { item, issues, groups, target, previous, externalMatch, courseCandidates, courseId, topicMappings, changes, input,
      plannedAttempts, fingerprint, historyImages, statementSourceKey: sourceKey };
  }));

  const matches = await store.duplicateMatches(drafts.map(({ fingerprint, target }) => ({ fingerprint, exclude: target?.questionId })));
  const plans = await Promise.all(drafts.map(async (draft, index) => {
    const { item, fingerprint, externalMatch, target, input, plannedAttempts } = draft;
    const duplicates: store.Duplicate[] = matches[index];
    if (externalMatch && externalMatch.questionId !== target?.questionId) duplicates.unshift({
      id: externalMatch.questionId, title: externalMatch.title, version: null, reason: "external_id", excerpt: "",
    });
    for (const other of drafts) {
      if (item.id === other.item.id || ["committed", "rejected", "skipped"].includes(other.item.status)) continue;
      const sameStatement = fingerprint.statementHash && fingerprint.statementHash === other.fingerprint.statementHash;
      if (sameStatement || fingerprint.imageHashes.some((hash) => other.fingerprint.imageHashes.includes(hash))) {
        duplicates.push({ id: other.item.id, title: other.fingerprint.title, version: null, reason: "batch", excerpt: other.fingerprint.statement.slice(0, 240) });
      }
      if (plannedAttempts.some(({ externalId }) => other.plannedAttempts.some((attempt) => attempt.externalId === externalId))) {
        draft.issues.push({ path: "/attempts", code: "DUPLICATE_ATTEMPT", message: "同一批次的多题引用了同一作答外部标识。", severity: "blocking" });
      }
    }
    const planHash = await importDigest({
      candidate: item.candidateJson, mapping: item.mappingJson, input, target, attempts: plannedAttempts,
      // Only database matches can change the destination of an already approved create.
      duplicates: duplicates.filter(({ reason }) => reason !== "batch"),
    });
    return { ...draft, kind: "question" as const, duplicates, planHash };
  }));
  return { plans: [...plans, ...await topicPlans], courses: courseRows, topics: topicChoices, chapters: chapterRows };
}

export type ImportPlan = Awaited<ReturnType<typeof planImports>>["plans"][number];

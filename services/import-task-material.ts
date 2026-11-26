import { getAssetStore } from "@/adapters/assets";
import type { readImportTask } from "@/db/queries/import-tasks";
import type { ImportCheckpoint, TaskDraft, TaskEvidence, TaskSegment } from "@/domain/import-task";
import { Problem } from "@/domain/problem";
import { getAsset } from "@/services/assets";

export type TaskSnapshot = NonNullable<Awaited<ReturnType<typeof readImportTask>>>;
export type Checkpoint = TaskSnapshot["checkpoints"][number];

export function segmentsFrom(rows: Checkpoint[]) {
  const latest = new Map<number, TaskSegment>();
  for (const { event } of rows) {
    if (event.type === "segment") latest.set(event.segment.order, event.segment);
  }
  return [...latest.values()].sort((a, b) => a.order - b.order);
}

export function isReadable(segment: TaskSegment | undefined) {
  return segment?.status === "readable" || segment?.status === "processed";
}

export function projectCoverage(segments: TaskSegment[]) {
  const unregisteredRanges: { first: number; last: number }[] = [];
  let next = 1;
  for (const { order } of segments) {
    if (order > next) unregisteredRanges.push({ first: next, last: order - 1 });
    next = order + 1;
  }
  const readable = segments.filter(isReadable).length;
  const processed = segments.filter(({ status }) => status === "processed").length;
  const nextOrder = segments.find(({ status }) => status === "readable")?.order
    ?? unregisteredRanges[0]?.first
    ?? segments.find(({ status }) => status === "planned")?.order
    ?? segments.find(({ status }) => status === "unavailable")?.order
    ?? null;
  return { readable, processed, unregisteredRanges, nextOrder };
}

export function sameCheckpoint(a: unknown, b: unknown) {
  // Both event payloads are built from the same parsed, locally ordered fields.
  return JSON.stringify(a) === JSON.stringify(b);
}

export function checkSegment(segment: TaskSegment, segments: TaskSegment[], unitIds: Set<string>) {
  const { order, source, locator, status, excerpt, links, overlaps } = segment;
  const current = segments.find((entry) => entry.order === order);
  const conflict = (message: string, fields: Record<string, unknown> = {}) =>
    new Problem(409, "TASK_SEGMENT_CONFLICT", message, { segmentOrder: order, locator, ...fields });
  const duplicate = segments.find((entry) => entry.source === source && entry.locator === locator && entry.order !== order);
  if (duplicate || current && (current.source !== source || current.locator !== locator
    || current.excerpt && current.excerpt !== excerpt)) {
    throw conflict("分段序号、来源定位或逐字依据与已保存记录冲突。", { conflictingOrder: duplicate?.order ?? order });
  }
  if ((isReadable(segment) !== Boolean(excerpt)) || (!excerpt && links.length)) {
    throw new Problem(422, "TASK_SEGMENT_EVIDENCE", "可读及已处理片段须提供实际引句。缺失片段不能引用未读取内容。", { segmentOrder: order });
  }
  if (isReadable(current) && !isReadable(segment) || current?.status === "processed" && status !== "processed") {
    throw conflict("此片段已有更进后的处理记录。");
  }
  if (new Set(overlaps).size !== overlaps.length || overlaps.some((index) =>
    index === order || !segments.some((entry) => entry.order === index && entry.source === source))) {
    throw new Problem(422, "TASK_SEGMENT_OVERLAP", "重叠片段须是本任务同一来源中已登记的其他序号。", { segmentOrder: order });
  }
  if (current?.overlaps.some((index) => !overlaps.includes(index))
    || current?.links.some((previous) => !links.some((link) => sameCheckpoint(previous, link)))) {
    throw conflict("更新片段时须保留已登记的重叠及单元关系。");
  }
  const anchors = new Map(segments.filter((entry) => entry.source === source)
    .flatMap((entry) => entry.links.map((link) => [link.locator, link] as const)));
  const seen = new Set<string>();
  for (const link of links) {
    if (!unitIds.has(link.unitId)) {
      throw new Problem(404, "NOT_FOUND", "分段引用的单元不在此任务中。", { segmentOrder: order, unitId: link.unitId });
    }
    const prior = anchors.get(link.locator);
    if (seen.has(link.locator) || prior && !sameCheckpoint(prior, link)) {
      throw conflict("此消息定位已有不同的单元、角色或引句。请核对材料。", { evidenceLocator: link.locator, unitId: link.unitId });
    }
    seen.add(link.locator);
  }
}

export function checkDraft(draft: TaskDraft, segments: TaskSegment[], unitId: string) {
  for (const citation of draft.citations) {
    const segment = segments.find(({ order }) => order === citation.segmentOrder);
    if (!segment?.links.some((link) => link.unitId === unitId && link.locator === citation.locator
      && link.speaker === citation.speaker && link.quote === citation.quote)) {
      throw new Problem(422, "TASK_DRAFT_EVIDENCE", "草稿引句须与此单元已登记的可读片段关系一致。", { citation });
    }
  }
}

type Gap = Extract<ImportCheckpoint, { type: "needs_evidence" }>;

export function projectGaps(rows: Checkpoint[]) {
  const gaps = new Map<number, Gap & { version: number; supplements: { version: number; evidence: TaskEvidence }[] }>();
  for (const { event, version } of rows) {
    if (event.type === "needs_evidence") gaps.set(version, { ...event, version, supplements: [] });
    if (event.type === "evidence") gaps.get(event.evidence.gapVersion)?.supplements.push({ version, evidence: event.evidence });
  }
  return [...gaps.values()].map((gap) => ({
    ...gap, provided: gap.supplements.at(-1)?.evidence.complete === true,
  }));
}

export async function checkEvidence(ownerId: string, evidence: TaskEvidence, rows: Checkpoint[], segments: TaskSegment[]) {
  const gap = rows.find(({ version }) => version === evidence.gapVersion)?.event;
  const fields = { gapVersion: evidence.gapVersion };
  if (gap?.type !== "needs_evidence") throw new Problem(404, "NOT_FOUND", "此单元没有对应的缺口记录。", fields);
  if (evidence.segmentOrder !== undefined && !isReadable(segments.find(({ order }) => order === evidence.segmentOrder))) {
    throw new Problem(422, "TASK_SEGMENT_EVIDENCE", "补充材料只能引用已登记的可读分段。", { ...fields, segmentOrder: evidence.segmentOrder });
  }
  if (evidence.complete && (gap.gapKind === "original_image" ? !evidence.assetId : !evidence.quote)) {
    throw new Problem(422, "TASK_EVIDENCE_REQUIRED", "请提供实际原图或逐字材料，再标记为已补齐。", fields);
  }
  if (evidence.assetId) {
    const asset = await getAsset(evidence.assetId, ownerId);
    if (!asset || !(await getAssetStore().head(asset.storageKey))) {
      throw new Problem(422, "INVALID_ASSET", "原图未登记、无法读取或不属于当前 owner。", { ...fields, assetId: evidence.assetId });
    }
  }
}

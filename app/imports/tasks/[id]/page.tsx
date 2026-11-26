import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { ImportTaskEvidence } from "@/components/import-task-evidence";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { displayDateTime } from "@/lib/learning-display";
import { OwnerPage } from "@/lib/owner-page";
import { getImportTask } from "@/services/import-tasks";
import "@/components/imports.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "长对话整理进度" };

const preparationLabels = {
  unprocessed: "待处理", drafting: "草稿整理中", needs_evidence: "待补证", retry: "待修正",
  submitted: "提案已整理", owner_action: "等待 owner 处理", unknown: "待重新核对",
};
const reviewLabels = {
  pending: "待审核", approved: "已批准，待入库", committed: "已入库",
  skipped: "已跳过", rejected: "已拒绝", conflict: "提交冲突", failed: "提交失败",
};
const coverageLabels = { unknown: "聊天覆盖范围未知", partial: "仅有部分材料", complete_material: "已提供的材料可完整读取" };
const segmentLabels = { planned: "待提供", unavailable: "缺失或不可读", readable: "可读，待处理", processed: "已处理" };
const relationLabels = { origin: "原题或概念", follow_up: "追问", correction: "订正", alternative: "替代解法", context: "相关讨论" };
const gapLabels = {
  statement: "完整题干", original_image: "原题图片", follow_up: "追问原文", speaker: "发言归属",
  same_unit: "同题归属", source: "材料来源", course: "课程归属", formula_anchor: "公式定位",
};

export default async function ImportTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/imports/tasks/${id}`}>{async (ownerId) => {
    if (!idSchema.safeParse(id).success) notFound();
    const task = await getImportTask(ownerId, id).catch((error: unknown) => {
      if (error instanceof Problem && error.status === 404) notFound();
      throw error;
    });
    const { counts, scope } = task;
    const next = task.units.find(({ unitId }) => unitId === task.nextUnitId);
    const nextOrder = task.coverage.nextOrder;
    const nextSegment = task.segments.find(({ order }) => order === nextOrder);
    const unitsById = new Map(task.units.map((unit) => [unit.unitId, unit]));
    return <div className="import-workspace import-batch-key">
      <nav className="crumbs" aria-label="当前位置"><AppLink href="/imports?legacy=1">旧导入与长对话任务</AppLink></nav>
      <header className="page-head">
        <h1>{scope.title}</h1>
        {task.cancelledAt && <p role="status">已取消</p>}
        <div className="actions"><AppLink className="button" href={`/manage/task/${id}`}>取消或删除任务</AppLink></div>
        <p className="field-hint">长对话整理 · 上次保存于 {displayDateTime(task.updatedAt)} · 进度版本 {task.rowVersion}</p>
      </header>
      <section className="section" aria-labelledby="task-scope">
        <h2 id="task-scope">整理范围</h2>
        <p>指定范围　{scope.requestedScope}</p>
        <p>发起时可读　{scope.readableScope}</p>
        <p>{coverageLabels[scope.coverage]}</p>
        {scope.coverage !== "unknown" && <p>原始对话与其他分支的范围仍须按实际材料核对。</p>}
      </section>
      {!task.cancelledAt && <section className="section" aria-labelledby="task-resume">
        <h2 id="task-resume">继续整理</h2>
        {nextOrder !== null && <p>下一分段　<AppLink href={nextSegment ? `#segment-${nextOrder}` : "#task-segments"}>第 {nextOrder} 段</AppLink>
          {" · "}{nextSegment ? segmentLabels[nextSegment.status] : "范围尚未登记"}</p>}
        <p>{task.preparationComplete ? "已登记单元的提案整理完成。" : next
          ? <>接下来处理「<a href={`#unit-${next.unitId}`}>{next.title}</a>」 · {preparationLabels[next.preparation]}。</>
          : "下一步登记可读材料中的独立题目或知识点。"}</p>
        <p>在连接知识库的 ChatGPT 对话中发送「继续知识库整理任务 {task.taskId}」。如果 ChatGPT 读不到所需原材料，按下方的片段定位或缺口说明重新提供。</p>
      </section>}
      <section className="section" aria-labelledby="task-segments">
        <h2 id="task-segments">分段覆盖</h2>
        {task.segments.length ? <>
          <div className="import-batch-counts">
            <span>已登记 {task.segments.length} 段</span><span>可读 {task.coverage.readable} 段</span>
            <span>已处理 {task.coverage.processed} 段</span>
          </div>
          {task.coverage.unregisteredRanges.map(({ first, last }) => <p key={first}>
            尚未登记范围　第 {first === last ? first : `${first}–${last}`} 段
          </p>)}
          <ol className="import-items">{task.segments.map((segment) =>
            <li className="import-item create-panel" id={`segment-${segment.order}`} key={segment.order}>
              <h3>第 {segment.order} 段 · {segmentLabels[segment.status]}</h3>
              <p>{segment.source} · {segment.locator}</p>
              <p>{segment.note}</p>
              {!!segment.overlaps.length && <p>与第 {segment.overlaps.join("、")} 段重叠</p>}
              {segment.excerpt && <details className="import-detail">
                <summary>可读依据与单元关联</summary>
                <blockquote>{segment.excerpt}</blockquote>
                <ul className="import-issues">{segment.links.map((link) => <li key={link.locator}>
                  <a href={`#unit-${link.unitId}`}>{unitsById.get(link.unitId)?.title}</a> · {relationLabels[link.relation]} · {link.locator}
                </li>)}</ul>
              </details>}
            </li>)}</ol>
        </> : <p className="empty">还没有分段记录。</p>}
      </section>
      <section className="section" aria-labelledby="task-progress">
        <h2 id="task-progress">处理单元</h2>
        <div className="import-batch-counts">
          <span>已登记 {counts.units}</span><span>已提案 {counts.proposed}</span><span>待审核 {counts.waitingReview}</span>
          <span>待入库 {counts.readyToCommit}</span><span>已入库 {counts.committed}</span><span>待补证 {counts.needsEvidence}</span>
          <span>待修正 {counts.retry}</span><span>待处理 {counts.unprocessed}</span><span>待 owner 处理 {counts.ownerAction}</span>
          <span>草稿整理中 {counts.drafting}</span><span>状态待核对 {counts.unknown}</span>
        </div>
        {!!counts.units && <ul className="import-items">
          {task.units.map((unit) => {
            const review = unit.currentReview;
            const item = review?.item;
            const formal = unit.formalResult;
            const last = unit.checkpoints[unit.checkpoints.length - 1].event;
            const lastProposal = unit.checkpoints.findLast(({ event }) => event.type === "submitted")?.version ?? 0;
            return <li id={`unit-${unit.unitId}`} className="import-item create-panel" key={unit.unitId}>
              <header className="import-item-head">
                <h2>{unit.kind === "topic" ? unit.title : <QuestionTitle text={unit.title} />}</h2>
                <p>{unit.kind === "topic" ? "知识点" : "题目"} · {preparationLabels[unit.preparation]}</p>
              </header>
              <p>{unit.locator}</p>
              {formal && item && item.status !== "committed" && <p>已入库 · 有后续提案</p>}
              {last.type === "failed" && <p className="import-error">{last.error.code} · {last.error.message}</p>}
              {!!review?.issues?.length && <ul className="import-issues">
                {review.issues.map((issue, i) => <li key={i}>{issue.code} · {issue.message} {issue.path}</li>)}
              </ul>}
              <div className="actions">
                {review?.batchId && <AppLink className="text-link" href={`/imports/${review.batchId}${item ? `#item-${item.id}` : ""}`}>
                  查看候选 · {item ? reviewLabels[item.status] : "状态待核对"}
                </AppLink>}
                {formal && <AppLink className="text-link" href={formal.topicId ? `/topics/${formal.topicId}` : `/questions/${formal.questionId}`}>
                  查看已入库内容 · 导入版本 {formal.committedVersion}
                </AppLink>}
              </div>
              {unit.draft?.active && <details className="import-detail">
                <summary>未成稿草稿</summary>
                <p className="import-task-notes">{unit.draft.draft.notes}</p>
                <p>继续步骤　{unit.draft.draft.nextStep}</p>
                <ul className="import-issues">{unit.draft.draft.citations.map((citation, index) => <li key={index}>
                  <a href={`#segment-${citation.segmentOrder}`}>第 {citation.segmentOrder} 段</a> · {citation.locator} · 「{citation.quote}」
                </li>)}</ul>
              </details>}
              {!!unit.gaps.length && <section className="import-detail" aria-label="材料缺口">
                <h3>材料缺口</h3>
                <ul className="import-issues">{unit.gaps.map((gap) => <li key={gap.version} id={`gap-${gap.version}`}>
                  <p>{gap.gapKind && <strong>{gapLabels[gap.gapKind]} · </strong>}{gap.missing}
                    {gap.segmentOrder && <> · <a href={`#segment-${gap.segmentOrder}`}>第 {gap.segmentOrder} 段</a></>}
                  </p>
                  {!!gap.supplements.length && <ol>{gap.supplements.map(({ version, evidence }) => <li key={version}>
                    {evidence.complete ? "材料已补充" : "仍待补证"} · {evidence.locator} · {evidence.note}
                    {evidence.quote && <blockquote>{evidence.quote}</blockquote>}
                    {evidence.assetId && <> · <a href={`/api/v1/assets/${evidence.assetId}`}>查看补交原图</a></>}
                  </li>)}</ol>}
                  {!gap.provided && gap.version > lastProposal
                    && <ImportTaskEvidence key={task.rowVersion} taskId={id} unitId={unit.unitId} rowVersion={task.rowVersion}
                      gapVersion={gap.version} image={gap.gapKind === "original_image"} />}
                </li>)}</ul>
              </section>}
              <details className="import-detail">
                <summary>身份依据与保存记录</summary>
                <p>{unit.identityEvidence}</p>
                <ol className="import-issues">{unit.checkpoints.map(({ version, event, batchId, item }) => <li key={version}>
                  {event.type === "registered" && "登记单元"}
                  {event.type === "needs_evidence" && <>登记缺口 · {event.missing}</>}
                  {event.type === "draft" && (unit.draft?.version === version && unit.draft.active ? "保存草稿" : "保存草稿 · 已失效")}
                  {event.type === "evidence" && <>补充材料 · {event.evidence.locator}</>}
                  {event.type === "failed" && <>提案校验失败 · {event.error.code} · {event.error.message}</>}
                  {event.type === "submitted" && <>提交候选 · {event.materialNote}{" "}
                    {batchId && <AppLink href={`/imports/${batchId}`}>{item ? reviewLabels[item.status] : "查看审核"}</AppLink>}
                  </>}
                </li>)}</ol>
              </details>
            </li>;
          })}
        </ul>}
      </section>
    </div>;
  }}</OwnerPage>;
}

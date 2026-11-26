import { AppLink } from "@/components/app-link";
import { TechnicalDetails } from "@/components/technical-details";
import { ImportUpload } from "@/components/import-upload";
import { RecentContentOperation } from "@/components/recent-content-operation";
import { idSchema } from "@/domain/catalog";
import { contextImportNamespace } from "@/domain/context-reference";
import { historyImportNamespace } from "@/domain/history-reference";
import { displayDateTime } from "@/lib/learning-display";
import { OwnerPage } from "@/lib/owner-page";
import { listImportTasks } from "@/db/queries/import-tasks";
import { listImports } from "@/services/imports";
import { getLatestContentOperation } from "@/services/content-operations";
import "@/components/imports.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "导入与操作" };

const sourceLabels = new Map([
  [contextImportNamespace, "ChatGPT 对话"],
  [historyImportNamespace, "历史档案"],
]);
const pageSize = 50;

export default async function ImportsPage({ searchParams }: { searchParams: Promise<{ before?: string | string[]; legacy?: string }> }) {
  const params = await searchParams;
  const { data: before } = idSchema.safeParse(params.before);
  const legacy = params.legacy === "1" || Boolean(before);
  return <OwnerPage returnTo={before ? `/imports?before=${before}` : legacy ? "/imports?legacy=1" : "/imports"}>{async (ownerId) => {
    if (!legacy) {
      const latest = await getLatestContentOperation(ownerId);
      return <div className="import-workspace">
        <header className="page-head section-head"><h1>导入与操作</h1></header>
        <RecentContentOperation key={latest?.operationId ?? "empty"} latest={latest}
          timestamp={latest ? displayDateTime(latest.createdAt) : undefined} />
        <section className="section"><AppLink className="button" href="/imports?legacy=1">旧导入与长对话任务</AppLink></section>
      </div>;
    }
    const [rows, tasks] = await Promise.all([
      listImports(ownerId, { before, limit: pageSize + 1 }),
      before ? [] : listImportTasks(ownerId),
    ]);
    const batches = rows.slice(0, pageSize);
    const next = rows.length > pageSize && batches.at(-1);
    return <div className="import-workspace">
      <header className="page-head section-head"><h1>旧导入与长对话任务</h1><AppLink className="button" href="/imports/ai-review-settings">DeepSeek 设置</AppLink></header>
      {!before && <section className="section" aria-labelledby="import-tasks-heading">
        <h2 id="import-tasks-heading">长对话整理</h2>
        {tasks.length ? <ul className="import-batches">{tasks.map((task) => <li className="create-panel" key={task.id}>
          <div className="import-batch-name import-batch-key">
            <AppLink className="text-link" href={`/imports/tasks/${task.id}`}>{task.scope.title}</AppLink>
            <p className="field-hint">{task.scope.requestedScope}</p>
          </div>
          <span className="field-hint">{task.cancelledAt ? "已取消 · " : ""}进度版本 {task.rowVersion} · {displayDateTime(task.updatedAt)}</span>
        </li>)}</ul> : <p className="empty">在连接知识库的 ChatGPT 对话中发起分批整理，保存后可从这里查看进度。</p>}
      </section>}
      <section className="section" aria-labelledby="batch-list-heading">
        <h2 id="batch-list-heading">{before ? "较早批次" : "最近批次"}</h2>
        {batches.length ? <ul className="import-batches">{batches.map((batch) => <li className="create-panel" key={batch.id}>
          <div className="import-batch-name">
            <AppLink href={`/imports/${batch.id}`} className="text-link">{batch.sourceTitle || "学习资料导入"}</AppLink>
            <p className="field-hint">{sourceLabels.get(batch.namespace) ?? "手动导入"} · {displayDateTime(batch.createdAt)}</p>
            <TechnicalDetails fields={[["批次键", batch.batchKey], ["来源命名空间", batch.namespace], ["格式版本", batch.schemaVersion]]} />
          </div>
          <div className="import-batch-counts">
            <span>候选 {batch.total} 项</span><span>待审 {batch.pending} 项</span><span>已入库 {batch.committed}/{batch.total}</span>
          </div>
        </li>)}</ul> : <p className="empty">{before ? "没有更早的导入批次。" : "还没有导入批次。"}</p>}
        {(before || next) && <nav className="actions" aria-label="批次分页">
          {before && <AppLink className="button" href="/imports?legacy=1">最新批次</AppLink>}
          {next && <AppLink className="button" href={`/imports?before=${next.id}`}>更早的批次</AppLink>}
        </nav>}
      </section>
      <section className="section" aria-labelledby="batch-upload-heading">
        <h2 id="batch-upload-heading">手动上传批次</h2>
        <ImportUpload />
      </section>
    </div>;
  }}</OwnerPage>;
}

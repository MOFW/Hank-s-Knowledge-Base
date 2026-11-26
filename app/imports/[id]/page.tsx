import { AppLink } from "@/components/app-link";
import { TechnicalDetails } from "@/components/technical-details";
import { notFound } from "next/navigation";
import { ImportReview } from "@/components/import-review";
import { findImportTaskForBatch } from "@/db/queries/import-tasks";
import { idSchema } from "@/domain/catalog";
import { taskImportPrefix } from "@/domain/import-task";
import { Problem } from "@/domain/problem";
import { OwnerPage } from "@/lib/owner-page";
import { reviewHistory } from "@/services/ai-review";
import { getImport } from "@/services/imports";
import "@/components/imports.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "导入审核" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/imports/${id}`}>{async (ownerId) => {
    if (!idSchema.safeParse(id).success) notFound();
    const batch = await getImport(ownerId, id).catch((error: unknown) => {
      if (error instanceof Problem && error.status === 404) notFound();
      throw error;
    });
    const task = batch.batchKey.startsWith(taskImportPrefix) ? await findImportTaskForBatch(ownerId, id) : undefined;
    return <div className="import-workspace">
      <nav className="crumbs" aria-label="当前位置"><AppLink href="/imports?legacy=1">旧导入</AppLink>
        {task && <AppLink href={`/imports/tasks/${task.taskId}#unit-${task.unitId}`}>返回整理任务</AppLink>}
      </nav>
      <header className="page-head section-head">
        <div><h1>导入审核</h1><p className="field-hint">{batch.sources[0]?.title ?? "学习资料导入"}</p>
          <TechnicalDetails fields={[["批次编号", id], ["批次键", batch.batchKey], ["来源命名空间", batch.namespace]]} /></div>
        <div className="actions"><a className="button" href={`/api/v1/imports/${id}?view=original`}>下载批次 JSON</a>
          <AppLink className="button" href={`/manage/batch/${id}`}>清理候选或批次</AppLink></div>
      </header>
      <ImportReview initial={batch} initialAi={await reviewHistory(ownerId, id)} />
    </div>;
  }}</OwnerPage>;
}

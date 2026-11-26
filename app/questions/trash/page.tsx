import { AppLink } from "@/components/app-link";
import { and, desc, isNotNull, sql } from "drizzle-orm";
import { EmptyQuestionTrash } from "@/components/empty-question-trash";
import { QuestionTitle } from "@/components/question-title";
import { getDb } from "@/db";
import { questions, systemState } from "@/db/schema";
import { OwnerPage } from "@/lib/owner-page";
import { displayDateTime } from "@/lib/learning-display";
import { idSchema } from "@/domain/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "题目回收站" };

export default async function QuestionTrash({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const cursor = idSchema.safeParse((await searchParams).before).data;
  return <OwnerPage returnTo="/questions/trash">{async () => {
    const db = getDb();
    const [[state], rows] = await db.batch([db.select({ dataEpoch: systemState.dataEpoch }).from(systemState), db.select({ id: questions.id, title: questions.title, deletedAt: questions.deletedAt })
      .from(questions).where(and(isNotNull(questions.deletedAt), cursor ? sql`(${questions.deletedAt}, ${questions.id}) < (
        SELECT deleted_at, id FROM questions WHERE id = ${cursor})` : undefined))
      .orderBy(desc(questions.deletedAt), desc(questions.id)).limit(51)]);
    const shown = rows.slice(0, 50);
    const next = rows.length > 50 ? shown.at(-1)?.id : undefined;
    return <div className="catalog-page">
      <nav className="crumbs" aria-label="当前位置"><AppLink href="/questions">题库</AppLink></nav>
      <header className="page-head"><h1>题目回收站</h1><p>在单题管理中恢复题目，或永久删除题目、版本和学习记录。</p></header>
      {state && (shown.length > 0 || cursor) && <EmptyQuestionTrash dataEpoch={state.dataEpoch} />}
      {shown.length ? <ul className="import-batches">{shown.map(({ id, title, deletedAt }) =>
        <li key={id} className="create-panel">
          <AppLink className="text-link" href={`/manage/question/${id}`}><QuestionTitle text={title} /></AppLink>
          {deletedAt && <p className="field-hint">移入于 {displayDateTime(deletedAt)}</p>}
        </li>)}</ul> : <p className="empty">回收站没有题目。</p>}
      <div className="actions">
        {cursor && <AppLink className="button" href="/questions/trash">返回第一页</AppLink>}
        {next && <AppLink className="button" href={`/questions/trash?before=${next}`}>较早删除的题目</AppLink>}
      </div>
    </div>;
  }}</OwnerPage>;
}

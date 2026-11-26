import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { RevisionActions } from "@/components/revision-action";
import { RevisionLinks } from "@/components/revision-links";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getQuestion, listQuestionRevisions } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "题目版本记录" };

export default async function QuestionRevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const questionPath = `/questions/${id}`;
  const path = questionPath + "/revisions";
  return <OwnerPage returnTo={path}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const [question, revisions] = await Promise.all([getQuestion(id, ownerId, { includeDeleted: true }), listQuestionRevisions(id)]);
      if (!question || !revisions) notFound();
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span>
          {question.deletedAt ? <span><QuestionTitle text={question.title} /></span> : <AppLink href={questionPath}><QuestionTitle text={question.title} /></AppLink>}
        </nav>
        <header className="page-head">
          <h1>题目版本记录</h1>
          {question.deletedAt && <p>此题在回收站。<AppLink href={`/manage/question/${id}`}>管理此题</AppLink></p>}
        </header>
        <RevisionActions base={path} rowVersion={question.rowVersion} hasCurrent={revisions.some((r) => r.revisionNo === question.rowVersion)}
          hasHistory={revisions.length > 0} active={!question.deletedAt} />
        <RevisionLinks base={path} revisions={revisions} current={question.rowVersion} />
      </>;
    }}
  </OwnerPage>;
}

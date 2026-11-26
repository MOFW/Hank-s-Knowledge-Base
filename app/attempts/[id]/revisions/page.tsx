import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { RevisionActions } from "@/components/revision-action";
import { RevisionLinks } from "@/components/revision-links";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getAttempt, getQuestion, listAttemptRevisions } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "作答版本记录" };

export default async function AttemptRevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = `/attempts/${id}/revisions`;
  return <OwnerPage returnTo={path}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const [attempt, revisions] = await Promise.all([getAttempt(id, ownerId), listAttemptRevisions(id, ownerId)]);
      if (!attempt || !revisions) notFound();
      const question = await getQuestion(attempt.questionId, ownerId);
      if (!question) notFound();
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><AppLink href={`/questions/${question.id}#attempt-${id}`}><QuestionTitle text={question.title} /></AppLink>
        </nav>
        <header className="page-head"><h1>作答版本记录</h1></header>
        <RevisionActions base={path} rowVersion={attempt.rowVersion} hasCurrent={revisions.some((r) => r.revisionNo === attempt.rowVersion)}
          hasHistory={revisions.length > 0} />
        <RevisionLinks base={path} revisions={revisions} current={attempt.rowVersion} />
      </>;
    }}
  </OwnerPage>;
}

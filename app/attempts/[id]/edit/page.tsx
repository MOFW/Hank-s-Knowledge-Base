import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { AttemptEditor } from "@/components/learning-forms";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getAttempt, getQuestion } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "编辑作答" };

export default async function EditAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/attempts/${id}/edit`}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const attempt = await getAttempt(id, ownerId);
      if (!attempt) notFound();
      const question = await getQuestion(attempt.questionId, ownerId);
      if (!question) notFound();
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><AppLink href={`/questions/${question.id}#attempt-${id}`}><QuestionTitle text={question.title} /></AppLink>
          <span aria-hidden="true">/</span><span>编辑作答</span>
        </nav>
        <header className="page-head"><h1>编辑作答</h1></header>
        <AttemptEditor questionId={question.id} attempt={attempt} />
        <p><AppLink className="text-link" href={`/manage/attempt/${id}?from=edit`}>删除这条作答</AppLink></p>
      </>;
    }}
  </OwnerPage>;
}

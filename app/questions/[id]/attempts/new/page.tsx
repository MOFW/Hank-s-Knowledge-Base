import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { AttemptEditor } from "@/components/learning-forms";
import { Markdown } from "@/components/markdown";
import { OriginalQuestionImages } from "@/components/question-reading";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getQuestion } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "记录作答" };

export default async function NewAttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/questions/${id}/attempts/new`}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const question = await getQuestion(id, ownerId);
      if (!question) notFound();
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><AppLink href={`/questions/${id}`}><QuestionTitle text={question.title} /></AppLink>
          <span aria-hidden="true">/</span><span>记录作答</span>
        </nav>
        <header className="page-head"><h1>记录作答</h1></header>
        <div className="solve-layout">
          <details className="create-panel solve-reference" open>
            <summary>题干参照 · <QuestionTitle text={question.title} /></summary>
            <div className="panel-content"><Markdown source={question.statementMd} /><OriginalQuestionImages ids={question.originalAssetIds} /></div>
          </details>
          <AttemptEditor questionId={id} />
        </div>
      </>;
    }}
  </OwnerPage>;
}

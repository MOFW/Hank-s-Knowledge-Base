import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { QuestionEditor } from "@/components/question-editor";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { listCourses } from "@/services/catalog";
import { getQuestion, listQuestionTopicChoices } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "编辑题目" };

export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/questions/${id}/edit`}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const [question, courses, topics] = await Promise.all([getQuestion(id, ownerId), listCourses(), listQuestionTopicChoices()]);
      if (!question) notFound();
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><AppLink href={`/questions/${id}`}><QuestionTitle text={question.title} /></AppLink>
          <span aria-hidden="true">/</span><span>编辑</span>
        </nav>
        <header className="page-head"><h1>编辑题目</h1></header>
        <QuestionEditor courses={courses} topics={topics} question={question} />
      </>;
    }}
  </OwnerPage>;
}

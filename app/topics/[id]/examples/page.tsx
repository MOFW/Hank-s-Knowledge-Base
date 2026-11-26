import { notFound } from "next/navigation";
import { AppLink } from "@/components/app-link";
import { prepareReading } from "@/components/markdown-reading";
import { TopicQuestionEditor } from "@/components/topic-question-editor";
import { topicQuestionRelations } from "@/db/queries/question-topics";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { courseReadingHref } from "@/lib/reading-anchor";
import { getTopic } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "例题与关联题目" };

export default async function TopicExamplesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/topics/${id}/examples`}>
    {async () => {
      if (!idSchema.safeParse(id).success) notFound();
      const [topic, relations] = await Promise.all([getTopic(id), topicQuestionRelations(id)]);
      if (!topic) notFound();
      const { placements } = prepareReading(topic.bodyMd);
      return <div className="course-organizer">
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href={`/topics/${id}/edit`}>编辑笔记</AppLink><span aria-hidden="true">/</span><span>{topic.title}</span>
        </nav>
        <header className="page-head"><h1>例题与关联题目</h1></header>
        <p><AppLink className="text-link" href={topic.courseId ? courseReadingHref(topic.courseId, id) : `/topics/${id}`}>返回阅读</AppLink></p>
        <TopicQuestionEditor key={topic.rowVersion} topicId={id} version={topic.rowVersion} relations={relations} placements={placements} />
      </div>;
    }}
  </OwnerPage>;
}

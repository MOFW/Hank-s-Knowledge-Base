import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { relatedImportedTopics } from "@/db/queries/imports";
import { listQuestionTopicChoices } from "@/services/questions";
import { TopicEditor } from "@/components/catalog-forms";
import { idSchema } from "@/domain/catalog";
import { topicCourseChoices } from "@/services/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getTopic } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "编辑知识点" };

export default async function EditTopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/topics/${id}/edit`}>
    {async () => {
      if (!idSchema.safeParse(id).success) notFound();
      const topic = await getTopic(id);
      if (!topic) notFound();
      const [courses, related, choices] = await Promise.all([topicCourseChoices(), relatedImportedTopics(id), listQuestionTopicChoices()]);
      const course = courses.find(({ id }) => id === topic.courseId);
      return <>
        <nav className="crumbs" aria-label="当前位置"><AppLink href={course ? `/courses/${course.id}` : "/topics/unassigned"}>{course?.name ?? "未归类"}</AppLink><span aria-hidden="true">/</span><AppLink href={`/topics/${id}`}>{topic.title}</AppLink><span aria-hidden="true">/</span><span>编辑</span></nav>
        <header className="page-head"><h1>编辑知识点</h1></header>
        <p><AppLink className="text-link" href={`/topics/${id}/examples`}>整理例题与关联题目</AppLink></p>
        <TopicEditor courseId={topic.courseId} chapters={[]} courses={courses} topic={topic}
          relations={{ options: choices.filter((option) => option.id !== id), selected: related.map((item) => item.id) }} />
        <p><AppLink className="text-link" href={`/manage/topic/${id}?from=edit`}>删除笔记</AppLink></p>
      </>;
    }}
  </OwnerPage>;
}

import { AppLink } from "@/components/app-link";
import { QuestionEditor } from "@/components/question-editor";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { listCourses } from "@/services/catalog";
import { listQuestionTopicChoices } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "新增题目" };

export default async function NewQuestionPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const courseId = idSchema.safeParse(params.courseId).data;
  const topicId = idSchema.safeParse(params.topicId).data;
  const query = new URLSearchParams();
  if (courseId) query.set("courseId", courseId);
  if (topicId) query.set("topicId", topicId);
  const returnTo = "/questions/new" + (query.size ? `?${query}` : "");
  return <OwnerPage returnTo={returnTo}>
    {async () => {
      const [courses, topics] = await Promise.all([listCourses(), listQuestionTopicChoices()]);
      const topic = topics.find((option) => option.id === topicId);
      const defaultCourse = courses.find((course) => course.id === courseId) ?? courses.find((course) => course.id === topic?.courseId);
      return <>
        <nav className="crumbs" aria-label="当前位置"><AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><span>新增题目</span></nav>
        <header className="page-head"><h1>新增题目</h1></header>
        <QuestionEditor courses={courses} topics={topics} defaultCourseId={params.courseId === "unassigned" || topic?.courseId === null ? null : defaultCourse?.id} defaultTopicId={topic?.id} />
      </>;
    }}
  </OwnerPage>;
}

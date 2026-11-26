import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { TopicEditor } from "@/components/catalog-forms";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getCourse, topicCourseChoices } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "新增知识点" };

export default async function NewTopicPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ chapterId?: string | string[] }>;
}) {
  const { id } = await params;
  const { chapterId } = await searchParams;
  const path = `/courses/${id}/topics/new`;
  const returnTo = typeof chapterId === "string" ? `${path}?chapterId=${encodeURIComponent(chapterId)}` : path;
  return <OwnerPage returnTo={returnTo}>
    {async () => {
      if (!idSchema.safeParse(id).success) notFound();
      const [course, courses] = await Promise.all([getCourse(id), topicCourseChoices()]);
      if (!course) notFound();
      const chapters = courses.find((item) => item.id === id)?.chapters ?? [];
      return <>
        <nav className="crumbs" aria-label="当前位置"><AppLink href={`/courses/${id}`}>{course.name}</AppLink><span aria-hidden="true">/</span><span>添加笔记</span></nav>
        <header className="page-head"><h1>添加笔记</h1></header>
        <TopicEditor courseId={id} chapters={chapters} courses={courses} defaultChapter={chapters.find((item) => item.id === chapterId)?.id} />
      </>;
    }}
  </OwnerPage>;
}

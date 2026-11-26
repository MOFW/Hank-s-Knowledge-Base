import { notFound } from "next/navigation";
import { AppLink } from "@/components/app-link";
import { CourseReader } from "@/components/course-reader";
import { idSchema } from "@/domain/catalog";
import { groupDirectory } from "@/lib/directory";
import { OwnerPage } from "@/lib/owner-page";
import { courseReadingHref } from "@/lib/reading-anchor";
import { getReadingIndex, getReadingTopic } from "@/services/course-reading";

export const dynamic = "force-dynamic";

export default async function CourseReadingPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ topicId?: string }>;
}) {
  const { id } = await params;
  const { topicId } = await searchParams;
  const requested = idSchema.safeParse(topicId);
  return <OwnerPage returnTo={courseReadingHref(id, requested.success ? requested.data : undefined)}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const [index, requestedBody] = await Promise.all([
        getReadingIndex(id), requested.success ? getReadingTopic(id, requested.data, ownerId) : null,
      ]);
      if (!index) notFound();
      const { orderedTopics } = groupDirectory(index.chapters, index.topics);
      const picked = orderedTopics.find((note) => note.id === topicId) ?? orderedTopics[0];
      const initial = requestedBody ?? (picked ? await getReadingTopic(id, picked.id, ownerId) : null);
      if (!initial) return <div className="catalog-page">
        <h1>{index.name}</h1><p className="empty">{picked ? "课程内容已有变动，请重新打开阅读。" : "这门课程还没有笔记。"}</p>
        <AppLink className="button" href={`/courses/${id}`}>返回课程</AppLink>
      </div>;
      return <CourseReader key={id} courseId={id} ownerId={ownerId} name={index.name}
        chapters={index.chapters} notes={orderedTopics} initial={initial} />;
    }}
  </OwnerPage>;
}

import { notFound } from "next/navigation";
import { AppLink } from "@/components/app-link";
import { CreateCatalogForm, RenameCourse } from "@/components/catalog-forms";
import { ReadingOrderEditor } from "@/components/reading-order-editor";
import { idSchema } from "@/domain/catalog";
import { chapterOptions } from "@/lib/directory";
import { OwnerPage } from "@/lib/owner-page";
import { getDirectory } from "@/services/catalog";

export const dynamic = "force-dynamic";

export default async function CourseOrganizer({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chapterId?: string; kind?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const path = `/courses/${id}/organize`;
  const kind = search.kind === "chapter" ? "chapter" : "topic";
  return <OwnerPage returnTo={path}>
    {async () => {
      if (!idSchema.safeParse(id).success) notFound();
      const directory = await getDirectory(id);
      if (!directory) notFound();
      const { course, chapters, topics } = directory;
      const options = chapterOptions(chapters);
      const chapterId = options.find((chapter) => chapter.id === search.chapterId)?.id ?? null;
      const group = kind === "chapter" ? chapters.filter((chapter) => chapter.parentId === chapterId) : topics.filter((topic) => topic.chapterId === chapterId);
      const items = group.map(({ id, title, rowVersion }) => ({ id, title, rowVersion }));
      const returnTo = path + `?kind=${kind}` + (chapterId ? `&chapterId=${chapterId}` : "");
      return <div className="catalog-page course-organizer">
        <nav className="crumbs" aria-label="当前位置"><AppLink href="/courses">课程</AppLink><span aria-hidden="true">/</span>
          <AppLink href={`/courses/${id}`}>{course.name}</AppLink>
        </nav>
        <header className="page-head"><h1>课程与章节管理</h1></header>
        <ReadingOrderEditor key={JSON.stringify([kind, chapterId, items])} courseId={id} chapterId={chapterId}
          kind={kind} chapters={options} items={items} returnTo={returnTo} />
        <CreateCatalogForm courseId={id} chapters={options} returnTo={returnTo} />
        <RenameCourse key={course.rowVersion} id={id} name={course.name} rowVersion={course.rowVersion} returnTo={returnTo} />
        <AppLink className="text-link" href={`/courses/${id}/delete`}>删除课程</AppLink>
      </div>;
    }}
  </OwnerPage>;
}

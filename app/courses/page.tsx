import { AppLink } from "@/components/app-link";
import { CourseShelf } from "@/components/course-shelf";
import { CreateCatalogForm } from "@/components/catalog-forms";
import { OwnerPage } from "@/lib/owner-page";
import { listCourses } from "@/services/catalog";
import { Suspense } from "react";
import { LoadingRows } from "@/components/route-loading";

export const dynamic = "force-dynamic";
export const metadata = { title: "课程目录" };

async function Courses() {
  return <CourseShelf courses={await listCourses()} />;
}

export default function CoursesPage() {
  return <OwnerPage returnTo="/courses">
    {() => (
      <div className="catalog-page">
        <header className="page-head"><h1>课程目录</h1><div className="actions"><AppLink className="button" href="/topics/unassigned">未归类笔记</AppLink><AppLink className="button" href="/topics/new">添加笔记</AppLink></div></header>
        <Suspense fallback={<LoadingRows />}><Courses /></Suspense>
        <CreateCatalogForm />
        <p><AppLink className="text-link" href="/courses/deleted">旧课程档案</AppLink></p>
      </div>
    )}
  </OwnerPage>;
}

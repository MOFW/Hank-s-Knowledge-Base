import { AppLink } from "@/components/app-link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { OwnerPage } from "@/lib/owner-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "旧课程档案" };

export default function DeletedCourseHistory() {
  return <OwnerPage returnTo="/courses/deleted">{async () => {
    const rows = await getDb().all<{ id: string; name: string }>(sql`
      SELECT course_id AS id, coalesce(json_extract(snapshot_json, '$.name'), course_id) AS name
      FROM course_deletions d WHERE json_type(snapshot_json, '$.name') IS NOT NULL
        OR EXISTS (SELECT 1 FROM deleted_course_revisions r WHERE r.course_id = d.course_id)
      ORDER BY deleted_at DESC, course_id
    `);
    return <div className="catalog-page">
      <nav className="crumbs" aria-label="当前位置"><AppLink href="/courses">课程</AppLink></nav>
      <header className="page-head"><h1>旧课程档案</h1></header>
      {rows.length ? <ul className="topic-list">{rows.map(({ id, name }) => <li key={id}>
        <AppLink className="text-link" href={`/manage/course-history/${id}`}>{name}</AppLink>
      </li>)}</ul> : <p className="empty">没有待清理的课程档案。</p>}
    </div>;
  }}</OwnerPage>;
}

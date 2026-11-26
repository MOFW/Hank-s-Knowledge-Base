import { AppLink } from "@/components/app-link";
import { OwnerPage } from "@/lib/owner-page";
import { listUnassignedTopics } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "未归类笔记" };

export default function UnassignedNotes() {
  return <OwnerPage returnTo="/topics/unassigned">{async () => {
    const topics = await listUnassignedTopics();
    return <div className="catalog-page">
      <nav className="crumbs" aria-label="当前位置"><AppLink href="/courses">课程</AppLink></nav>
      <header className="page-head section-head">
        <h1>未归类笔记</h1>
        <div className="actions"><AppLink className="button" href="/questions?courseId=unassigned">未归类题目</AppLink><AppLink className="button primary" href="/topics/new">添加笔记</AppLink></div>
      </header>
      {topics.length ? <ul className="topic-list">{topics.map(({ id, title }) =>
        <li key={id}><AppLink className="text-link" href={`/topics/${id}`}>{title}</AppLink></li>)}</ul>
        : <p className="empty">还没有未归类笔记。</p>}
    </div>;
  }}</OwnerPage>;
}

import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { RevisionActions } from "@/components/revision-action";
import { RevisionLinks } from "@/components/revision-links";
import { revisionList } from "@/db/queries/questions";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getTopic } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "笔记历史版本" };

export default async function TopicRevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = `/topics/${id}`;
  const base = path + "/revisions";
  return <OwnerPage returnTo={base}>{async () => {
    if (!idSchema.safeParse(id).success) notFound();
    const [topic, revisions] = await Promise.all([getTopic(id), revisionList("topic", id)]);
    if (!topic) notFound();
    return <div className="catalog-page">
      <nav className="crumbs" aria-label="当前位置"><AppLink href={path}>{topic.title}</AppLink></nav>
      <header className="page-head"><h1>笔记历史版本</h1></header>
      <RevisionActions base={base} rowVersion={topic.rowVersion} hasCurrent={revisions.some((r) => r.revisionNo === topic.rowVersion)}
        hasHistory={revisions.length > 0} />
      <RevisionLinks base={base} revisions={revisions} current={topic.rowVersion} />
    </div>;
  }}</OwnerPage>;
}

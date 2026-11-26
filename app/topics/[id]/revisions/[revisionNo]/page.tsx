import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { NoteSupplement } from "@/components/note-supplement";
import { RevisionButton } from "@/components/revision-action";
import { revisionDetail } from "@/db/queries/questions";
import { idSchema } from "@/domain/catalog";
import { revisionPath } from "@/domain/questions";
import { displayDateTime } from "@/lib/learning-display";
import { OwnerPage } from "@/lib/owner-page";
import { getTopic } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "笔记历史快照" };

export default async function TopicRevisionPage({ params }: { params: Promise<{ id: string; revisionNo: string }> }) {
  const { id, revisionNo: raw } = await params;
  const base = `/topics/${id}/revisions`;
  return <OwnerPage returnTo={`${base}/${raw}`}>{async () => {
    const revisionNo = revisionPath.safeParse(raw).data;
    if (!idSchema.safeParse(id).success || !revisionNo) notFound();
    const [topic, revision] = await Promise.all([getTopic(id), revisionDetail("topic", id, revisionNo)]);
    if (!topic || !revision) notFound();
    const { title, summaryMd, bodyMd, supplementMd } = revision.snapshotJson as {
      title: string; summaryMd: string; bodyMd: string; supplementMd?: string | null;
    };
    return <>
      <nav className="crumbs" aria-label="当前位置"><AppLink href={base}>笔记历史版本</AppLink></nav>
      <article className="reading">
        <header className="reading-head">
          <h1>{title}</h1>
          <p className="version"><time dateTime={revision.createdAt}>{displayDateTime(revision.createdAt)}</time></p>
          {summaryMd && <Markdown source={summaryMd} />}
        </header>
        <Markdown source={bodyMd} />
        <NoteSupplement source={supplementMd} />
        <div className="actions">
          {topic.rowVersion !== revisionNo && <RevisionButton base={base}
            action={{ action: "restore", rowVersion: topic.rowVersion, revisionNo }} label="恢复此版本"
            confirm="恢复此版本记录的笔记内容？当前归属与关联会保留。" notice="已恢复笔记内容" />}
          <RevisionButton base={base} action={{ action: "delete", revisionNo }} label="删除此版本"
            confirm="永久删除此历史快照？当前笔记会保留。" notice="已删除历史版本" />
        </div>
      </article>
    </>;
  }}</OwnerPage>;
}

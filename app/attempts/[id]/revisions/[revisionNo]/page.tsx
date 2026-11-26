import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { RevisionButton } from "@/components/revision-action";
import { RestoreRevision } from "@/components/learning-forms";
import { AttemptNotes } from "@/components/question-reading";
import { idSchema } from "@/domain/catalog";
import { correctionAuthorLabels, displayDateTime, outcomeLabels } from "@/lib/learning-display";
import { OwnerPage } from "@/lib/owner-page";
import { getAttempt, getAttemptRevision } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "作答历史版本" };

type Snapshot = {
  attemptedAt: string | null;
  originalWorkMd: string | null;
  errorAnalysisMd: string | null;
  correctionMd: string | null;
  insightMd: string | null;
  outcome: keyof typeof outcomeLabels;
  correctionAuthorKind: keyof typeof correctionAuthorLabels;
};

export default async function AttemptRevisionPage({ params }: {
  params: Promise<{ id: string; revisionNo: string }>;
}) {
  const { id, revisionNo: raw } = await params;
  const base = `/attempts/${id}/revisions`;
  return <OwnerPage returnTo={`${base}/${raw}`}>
    {async (ownerId) => {
      const revisionNo = Number(raw);
      if (!idSchema.safeParse(id).success || !Number.isSafeInteger(revisionNo) || revisionNo < 1 || String(revisionNo) !== raw) notFound();
      const [attempt, revision] = await Promise.all([getAttempt(id, ownerId), getAttemptRevision(id, ownerId, revisionNo)]);
      if (!attempt || !revision) notFound();
      const snapshot = revision.snapshotJson as Snapshot;
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><AppLink href={base}>作答版本记录</AppLink>
        </nav>
        <article className="reading">
          <header className="reading-head">
            <h1>作答版本 {revisionNo}</h1>
            <p className="version"><time dateTime={revision.createdAt}>{displayDateTime(revision.createdAt)}</time> · {outcomeLabels[snapshot.outcome]}</p>
            {snapshot.attemptedAt && <p className="version">作答于 <time dateTime={snapshot.attemptedAt}>{displayDateTime(snapshot.attemptedAt)}</time></p>}
          </header>
          <AttemptNotes attempt={snapshot} />
          {revisionNo !== attempt.rowVersion && <RestoreRevision url={`/api/v1/attempts/${id}/restore`}
            version={attempt.rowVersion} revisionNo={revisionNo} returnTo={`/questions/${attempt.questionId}#attempt-${id}`} />}
          <div className="actions"><RevisionButton base={base} action={{ action: "delete", revisionNo }} label="删除此版本"
            confirm="永久删除此历史快照？当前作答会保留。" notice="已删除历史版本" /></div>
        </article>
      </>;
    }}
  </OwnerPage>;
}

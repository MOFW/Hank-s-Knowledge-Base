import { AppLink } from "@/components/app-link";
import { ArrowRight } from "lucide-react";
import { displayDateTime } from "@/lib/learning-display";

export function RevisionLinks({ base, revisions, current }: {
  base: string;
  revisions: { id: string; revisionNo: number; createdAt: string; reason: string | null }[];
  current: number;
}) {
  if (!revisions.length) return <p className="empty">还没有历史版本。</p>;
  return <ol className="question-list">
    {revisions.map((revision) => <li key={revision.id}>
      <AppLink href={`${base}/${revision.revisionNo}`}>
        <div>
          <strong>版本 {revision.revisionNo}</strong>
          <p><time dateTime={revision.createdAt}>{displayDateTime(revision.createdAt)}</time>
            {current === revision.revisionNo && " · 对应当前修订"}
            {revision.reason && ` · ${revision.reason}`}
          </p>
        </div>
        <ArrowRight size={17} aria-hidden="true" />
      </AppLink>
    </li>)}
  </ol>;
}

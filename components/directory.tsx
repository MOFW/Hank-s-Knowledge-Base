import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppLink } from "./app-link";

type Note = { id: string; title: string };

export function TopicNeighbors({ previous, next }: { previous?: Note; next?: Note }) {
  if (!previous && !next) return null;
  return <nav className="topic-neighbors" aria-label="相邻笔记">
    {previous && <AppLink href={`/topics/${previous.id}`} rel="prev">
      <ArrowLeft size={18} aria-hidden="true" /><span><small>上一篇</small>{previous.title}</span>
    </AppLink>}
    {next && <AppLink href={`/topics/${next.id}`} prefetch rel="next">
      <span><small>下一篇</small>{next.title}</span><ArrowRight size={18} aria-hidden="true" />
    </AppLink>}
  </nav>;
}

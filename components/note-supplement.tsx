import { Markdown } from "./markdown";

export function NoteSupplement({ source }: { source?: string | null }) {
  if (!source?.trim()) return null;
  return <details className="note-supplement">
    <summary>学习补充</summary>
    <div className="note-supplement-body"><Markdown source={source} /></div>
  </details>;
}

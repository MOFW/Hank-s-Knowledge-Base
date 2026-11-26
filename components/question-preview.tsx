"use client";

import { AppLink } from "@/components/app-link";
import { useRef, useState } from "react";
import { Markdown } from "@/components/markdown";

type Preview = { statementMd: string; originalAssetIds: string[] };

/** Read on demand; answers are never rendered in the browsing preview. */
export function QuestionPreview({ id }: { id: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const loading = useRef(false);

  async function load() {
    if (preview || loading.current) return;
    loading.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/questions/${id}?view=statement`, { cache: "no-store" });
      if (!response.ok) throw new Error("无法加载题干，请稍后重试或打开题目。");
      const { data } = await response.json() as { data: Preview };
      setPreview({ statementMd: data.statementMd, originalAssetIds: data.originalAssetIds });
    } catch {
      setError("无法加载题干，请稍后重试或打开题目。");
    } finally {
      loading.current = false;
      setPending(false);
    }
  }

  return <details className="question-preview" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary>预览题干</summary>
    <div className="question-preview-content" aria-busy={pending}>
      {pending && <p role="status">正在读取题干…</p>}
      {error && <div><p role="alert">{error}</p><button type="button" className="button small" onClick={() => void load()}>重试</button></div>}
      {preview && <>
        {preview.statementMd.trim() ? <Markdown source={preview.statementMd} /> : <p className="empty">本题没有文字题干。</p>}
        {preview.originalAssetIds.length > 0 && <p className="field-hint">附有 {preview.originalAssetIds.length} 张原题图片，可进入题目查看。</p>}
        <AppLink className="text-link" href={`/questions/${id}`}>进入题目，开始作答 →</AppLink>
      </>}
    </div>
  </details>;
}

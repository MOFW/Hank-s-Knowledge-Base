"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { useNavigateAfterSave } from "./save-notice";

const subscribe = () => () => {};

export function ImportUpload() {
  const navigateAfterSave = useNavigateAfterSave();
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ raw: string; key: string } | null>(null);

  return <form className="create-panel import-upload" onSubmit={async (event) => {
    event.preventDefault();
    if (pending) return;
    const file = new FormData(event.currentTarget).get("batch");
    if (!(file instanceof File) || file.size === 0) return;
    if (file.size > 900_000) {
      setError("批次超过 900,000 字节，请拆分为多个 JSON 文件。");
      return;
    }
    setPending(true);
    setError("");
    try {
      const raw = await file.text();
      if (attempt.current?.raw !== raw) attempt.current = { raw, key: crypto.randomUUID() };
      const response = await fetch("/api/v1/imports", {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body: raw,
      });
      const payload = await response.json() as { data?: { id: string }; error?: { message?: string; fields?: { path: string; message: string }[] } };
      if (!response.ok) {
        const fields = Array.isArray(payload.error?.fields) ? payload.error.fields : [];
        setError(fields.length ? fields.map((field: { path: string; message: string }) => `${field.path} ${field.message}`).join("\n")
          : payload.error?.message ?? "无法接收批次。");
        return;
      }
      if (!payload.data) throw new Error();
      navigateAfterSave(`/imports/${payload.data.id}`, "批次已接收");
    } catch {
      setError("未收到接收结果。可重新提交同一文件。");
    } finally {
      setPending(false);
    }
  }}>
    <label>候选批次文件<input type="file" name="batch" accept=".json,application/json" required disabled={!ready || pending} /></label>
    <p className="field-hint">支持题目契约 v1.0、v1.1，以及题目和知识点可混合的 v1.2。每批最多 50 项。</p>
    <button type="submit" className="button primary" disabled={!ready || pending}>{pending ? "正在接收…" : "上传候选批次"}</button>
    {error && <p className="import-error" role="alert">{error}</p>}
  </form>;
}

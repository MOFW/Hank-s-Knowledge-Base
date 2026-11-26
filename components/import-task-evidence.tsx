"use client";

import { useRef, useState, type FormEvent } from "react";
import { sha256 } from "@/lib/hash";
import { maxImageBytes } from "@/lib/image-signatures";
import { useNavigateAfterSave } from "./save-notice";

type Props = { taskId: string; unitId: string; gapVersion: number; rowVersion: number; image: boolean };

export function ImportTaskEvidence({ taskId, unitId, gapVersion, rowVersion, image }: Props) {
  const navigateAfterSave = useNavigateAfterSave();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const retry = useRef<{ body: string; key: string } | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const file = form.get("image");
      let assetId: string | undefined;
      if (file instanceof File && file.size) {
        if (file.size > maxImageBytes) throw new Error("图片大小不能超过 8 MiB。");
        const digest = await sha256(await file.arrayBuffer());
        const key = await sha256(new TextEncoder().encode(JSON.stringify([file.name, file.type, digest])));
        const response = await fetch("/api/v1/assets", {
          method: "POST", body: file, headers: {
            "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name),
            "X-Image-SHA256": digest, "Idempotency-Key": "task-image-" + key,
          },
        });
        const payload = await response.json() as { error?: { message?: string }; data?: { id: string } };
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "原图登记失败，请重试。");
        assetId = payload.data.id;
      }
      const body = JSON.stringify({
        gapVersion, note: form.get("note"), locator: form.get("locator"), assetId,
        quote: String(form.get("quote") ?? "").trim() || undefined, complete: form.has("complete"),
      });
      if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
      const response = await fetch(`/api/v1/import-tasks/${taskId}/units/${unitId}/evidence`, {
        method: "POST", body, headers: {
          "Content-Type": "application/json", "Idempotency-Key": retry.current.key, "If-Match": `"v${rowVersion}"`,
        },
      });
      if (!response.ok) {
        const { error } = await response.json() as { error?: { message?: string } };
        throw new Error(error?.message ?? "补证保存失败，请重试。");
      }
      window.history.replaceState(window.history.state, "", `#gap-${gapVersion}`);
      navigateAfterSave(location.pathname + location.search, "补证已保存");
    } catch (error) {
      setError(error instanceof Error ? error.message : "补证保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <details className="import-detail">
    <summary>{image ? "补交原图" : "补充材料"}</summary>
    <form className="import-evidence-form" onSubmit={save}>
      {image && <label>实际原图 <input name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></label>}
      <label>原材料定位 <input name="locator" required maxLength={300} /></label>
      <label>补充说明 <textarea name="note" required maxLength={2000} rows={2} /></label>
      {!image && <label>可核对的原话 <textarea name="quote" maxLength={600} rows={2} /></label>}
      <label className="import-evidence-check"><input type="checkbox" name="complete" /> 此缺口的材料已补齐</label>
      {error && <p role="alert" className="import-error">{error}</p>}
      <div><button className="button" type="submit" disabled={busy}>{busy ? "保存中…" : "保存补充"}</button></div>
    </form>
  </details>;
}

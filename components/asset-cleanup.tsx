"use client";

import { AppLink } from "@/components/app-link";
import { useState, type FormEvent } from "react";
import { ConfirmActions } from "./management-form";
import { useNavigateAfterSave } from "./save-notice";
import { useSave } from "./use-save";

type Affected = { href: string | null; title: string; kind: "attachment" | "text" | "draft" | "statement" | "undo" };
const hint = {
  attachment: "可随附件移除",
  text: "请先在正文移除链接",
  draft: "请先处理候选或任务",
  statement: "请先补充题干或另一张图",
  undo: "最近一轮可撤销期间保留",
};

export function AssetCleanup({ dataEpoch, rows }: {
  dataEpoch: number;
  rows: { id: string; name: string; status: string; references: number; affected: Affected[] }[];
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const { save, pending, disabled, error } = useSave("/api/v1/management/assets");
  if (!rows.length) return <p className="empty">此页没有附件。</p>;
  const unused = rows.filter((row) => !row.references);
  const detach = rows.some((row) => selected.includes(row.id) && row.references > 0);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.length) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    if (await save({ dataEpoch, assetIds: selected, detach })) navigateAfterSave("/manage/assets", "附件已清理");
  }
  return <form method="post" onSubmit={submit} aria-busy={pending}>
    <fieldset disabled={disabled || confirming}>
      <div className="actions">
        <button className="button" type="button" disabled={!unused.length}
          onClick={() => setSelected(unused.map(({ id }) => id))}>选择本页所有未使用附件</button>
      </div>
      <ul className="import-batches">{rows.map(({ id, name, references, status, affected }) => <li key={id} className="create-panel">
        <label className="check-field">
          <input type="checkbox" disabled={affected.some(({ kind }) => kind !== "attachment")} checked={selected.includes(id)} onChange={(event) =>
            setSelected((prev) => event.target.checked ? [...prev, id] : prev.filter((value) => value !== id))} />
          <span>{name} · {status === "deleted" ? "待重试文件清理" : status === "pending" ? "未完成的上传" : references ? `${references} 处现行引用` : "当前未使用"}</span>
        </label>
        {status === "ready" && <a className="text-link" href={`/api/v1/assets/${id}`}>查看原图</a>}
        {affected.length > 0 && <ul>{affected.map(({ href, kind, title }, index) => <li key={index}>
          {href ? <AppLink className="text-link" href={href}>{title}</AppLink> : title} · {hint[kind]}
        </li>)}</ul>}
      </li>)}</ul>
    </fieldset>
    {confirming && <p>{detach ? "从列出的资料中移除附件，并永久删除文件？" : `永久清理所选 ${selected.length} 个附件？`}</p>}
    <ConfirmActions label={confirming ? "确认删除" : detach ? "移除引用并删除所选附件" : "清理所选附件"} cancelHref="/questions"
      cancelAction={confirming ? () => setConfirming(false) : undefined} pending={pending} error={error} disabled={disabled || !selected.length} />
  </form>;
}

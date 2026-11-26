"use client";

import { useState } from "react";
import type { RevisionAction } from "@/domain/revisions";
import { useNavigateAfterSave } from "./save-notice";
import { useSave } from "./use-save";

export function RevisionButton({ base, action, label, confirm, notice }: {
  base: string; action: RevisionAction; label: string; confirm?: string; notice: string;
}) {
  const navigateAfterSave = useNavigateAfterSave();
  const { save, disabled, pending, error } = useSave("/api/v1" + base);
  const [confirming, setConfirming] = useState(false);
  const danger = action.action === "delete" || action.action === "clear";
  async function apply() {
    if (await save(action)) navigateAfterSave(base, notice);
  }
  return <>
    <button type="button" className={danger ? "button danger" : "button"} disabled={disabled || confirming}
      onClick={() => confirm ? setConfirming(true) : void apply()}>{pending ? "正在处理…" : label}</button>
    {confirming && <div className="panel-content" role="group" aria-label={label}>
      <p>{confirm}</p>
      <div className="actions">
        <button className={danger ? "button danger" : "button primary"} type="button" disabled={disabled}
          onClick={apply}>{danger ? "确认删除" : "确认恢复"}</button>
        <button className="button" type="button" disabled={pending} onClick={() => setConfirming(false)}>取消</button>
      </div>
    </div>}
    {error && <p role="alert">{error}</p>}
  </>;
}

export function RevisionActions({ base, rowVersion, hasCurrent, hasHistory, active = true }: {
  base: string; rowVersion: number; hasCurrent: boolean; hasHistory: boolean; active?: boolean;
}) {
  return <div className="actions">
    {active && (hasCurrent ? <p className="field-hint">当前修订已有快照。</p> :
      <RevisionButton base={base} action={{ action: "save", rowVersion }} label="保存当前版本" notice="已保存历史版本" />)}
    {hasHistory && <RevisionButton base={base} action={{ action: "clear" }} label="清空历史版本"
      confirm="永久清空历史快照？当前资料会保留。" notice="已清空历史版本" />}
  </div>;
}

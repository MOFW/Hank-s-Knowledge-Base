"use client";

import { useState } from "react";
import { useNavigateAfterSave } from "./save-notice";
import { useSave } from "./use-save";

export function EmptyQuestionTrash({ dataEpoch }: { dataEpoch: number }) {
  const navigateAfterSave = useNavigateAfterSave();
  const { save, disabled, pending, error } = useSave("/api/v1/management/question-trash");
  const [confirming, setConfirming] = useState(false);
  return <div className="actions">
    {!confirming ? <button className="button danger" type="button" disabled={disabled}
      onClick={() => setConfirming(true)}>清空题目回收站</button> : <div className="panel-content">
      <p>永久删除回收站里的所有题目、历史和学习记录？</p>
      <div className="actions">
        <button className="button danger" type="button" disabled={disabled} onClick={async () => {
          if (await save({ dataEpoch })) navigateAfterSave("/questions/trash", "回收站已清空");
        }}>{pending ? "正在清空…" : "确认清空"}</button>
        <button className="button" type="button" disabled={pending} onClick={() => setConfirming(false)}>取消</button>
      </div>
    </div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

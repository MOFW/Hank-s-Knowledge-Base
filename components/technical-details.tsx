"use client";

import { useState } from "react";

export function TechnicalDetails({ fields }: { fields: [label: string, value: string][] }) {
  const [message, setMessage] = useState("");
  if (!fields.length) return null;
  return <details className="technical-details">
    <summary>技术详情</summary>
    <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><code>{value}</code></dd></div>)}</dl>
    <button className="text-link" type="button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(fields.map(([label, value]) => `${label}：${value}`).join("\n"));
        setMessage("已复制");
      } catch {
        setMessage("请选中文字复制");
      }
    }}>复制技术详情</button>
    <span role="status">{message}</span>
  </details>;
}

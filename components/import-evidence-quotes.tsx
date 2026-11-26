import type { Evidence } from "@/domain/imports";
import { TechnicalDetails } from "./technical-details";

const speakers = { learner: "学习者", assistant: "助手", source_author: "原作者", unknown: "角色未知" };

export function ImportEvidenceQuotes({ evidence, sources }: {
  evidence?: Evidence[]; sources: { source_key: string; title: string }[];
}) {
  if (!evidence?.length) return null;
  return <details className="import-evidence-quotes" suppressHydrationWarning>
    <summary>查看原文引句（{evidence.length}）</summary>
    <ul>{evidence.map(({ source_key, locator, quote, speaker, history }, index) => <li key={index}>
      <p className="field-hint">{sources.find((source) => source.source_key === source_key)?.title ?? "来源待确认"} · {history ? `会话序号 ${history.location.ordinal}` : locator} · {speakers[speaker]}</p>
      <blockquote>{quote}</blockquote>
      <TechnicalDetails fields={[
        ["来源键", source_key],
        ...(history ? [["原档角色", history.role], ["原档条目", history.location.entryPath], ["消息路径", history.location.messagePath], ["摘要校验", history.location.digest], ["定位", locator]] as [string, string][] : []),
      ]} />
    </li>)}</ul>
  </details>;
}

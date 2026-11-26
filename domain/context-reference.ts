import type { AnyImportCandidate, Evidence, ImportIssue, ImportSource } from "./imports.ts";

export const contextImportNamespace = "chatgpt-context";

export const contextSourceLabel = "对话可见片段 · 未经原档核验";

// Reject both the named history locator and its bare revision form, even inside a context description.
const archiveLocator = /chatgpt:message:|[0-9a-f]{64}@[0-9a-f]{64}/i;
const contextPrefix = "context:";

export function contextQuoteFor(markdown: string, evidence: Evidence[] = []) {
  return evidence.find(({ quote }) => quote.includes(markdown));
}

export function contextSourceIssues(sources: ImportSource[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  sources.forEach(({ kind, source_key, external_id }, index) => {
    if (kind !== "chat") {
      issues.push({ path: `/sources/${index}/kind`, code: "CONTEXT_SOURCE_KIND", severity: "blocking",
        message: "对话可见片段的来源须使用 kind: chat。" });
    }
    for (const [key, value] of Object.entries({ source_key, external_id })) {
      if (value && archiveLocator.test(value)) {
        issues.push({ path: `/sources/${index}/${key}`, code: "CONTEXT_ARCHIVE_LOCATOR", severity: "blocking",
          message: "请使用批次内来源键或已知的来源标识，勿使用档案消息定位。" });
      }
    }
  });
  return issues;
}

export function contextCandidateIssues(candidate: AnyImportCandidate): ImportIssue[] {
  const issues: ImportIssue[] = [];
  function check(value: unknown, path: string) {
    if (!value || typeof value !== "object") return;
    // The closed candidate schema defines all accepted keys. Visit nested evidence without parsing prose.
    for (const [key, field] of Object.entries(value)) {
      const at = path + "/" + key;
      if (key === "history" || key === "history_images") {
        issues.push({ path: at, code: "CONTEXT_ARCHIVE_EVIDENCE", severity: "blocking",
          message: "对话可见片段禁止使用历史档案证据。" });
      } else if (key === "locator" && typeof field === "string"
        && (!field.startsWith(contextPrefix) || !field.slice(contextPrefix.length).trim() || archiveLocator.test(field))) {
        issues.push({ path: at, code: "CONTEXT_LOCATOR_REQUIRED", severity: "blocking",
          message: "请用 context: 加可查找的描述定位引文，勿使用档案消息定位。" });
      } else {
        check(field, at);
      }
      if (issues.length >= 20) break;
    }
  }
  check(candidate, "");
  return issues;
}

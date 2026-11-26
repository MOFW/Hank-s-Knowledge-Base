import type { Evidence } from "./imports.ts";

export const historyImportNamespace = "chatgpt-history";
export const revisionLocatorPattern = /^chatgpt:message:[0-9a-f]{64}@[0-9a-f]{64}$/;

export function historySpeaker(role: string): Evidence["speaker"] {
  if (role === "user") return "learner";
  if (role === "assistant") return "assistant";
  return "unknown";
}

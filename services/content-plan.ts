import type { ContentChange } from "@/domain/content-operations";
import { Problem } from "@/domain/problem";
import { conflict } from "@/services/writes";

export function versioned<T extends { rowVersion: number }>(row: T | null | undefined, version: number) {
  if (!row) throw new Problem(404, "NOT_FOUND", "找不到指定的正式资料。");
  if (row.rowVersion !== version) throw conflict(row.rowVersion);
  return row;
}

export function contentChange(kind: ContentChange["kind"], action: ContentChange["action"], id: string, rowVersion: number,
  path?: string, title?: string,
): ContentChange {
  const href = path ?? (kind === "attempt" ? `/attempts/${id}/edit` : kind === "asset" ? `/api/v1/assets/${id}`
    : kind === "learning" ? `/questions/${id}` : kind === "chapter" ? null : `/${kind}s/${id}`);
  return { kind, action, id, rowVersion, href: action === "delete" ? null : href, ...(title ? { title } : {}) };
}

export function replaceUnique(body: string, find: string, replacement: string) {
  const start = body.indexOf(find);
  if (start < 0 || body.indexOf(find, start + 1) >= 0) {
    throw new Problem(422, "AMBIGUOUS_TEXT", "请提供在目标正文中恰好出现一次的原文。");
  }
  return body.slice(0, start) + replacement + body.slice(start + find.length);
}

import { searchChapters, searchRows } from "@/db/queries/search";
import { Problem } from "@/domain/problem";
import { searchCursor, type SearchCursor, type SearchInput } from "@/domain/search";
import { listCourses } from "@/services/catalog";
import { listQuestionTopicChoices } from "@/services/questions";

const paths = { course: "/courses", topic: "/topics", question: "/questions" };

export function searchFilterChoices() {
  return Promise.all([listCourses(), searchChapters(), listQuestionTopicChoices()]);
}

function encodeCursor(cursor: SearchCursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(value: string) {
  try {
    return searchCursor.parse(JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    throw new Problem(422, "INVALID_CURSOR", "分页标记无效，请返回搜索第一页。");
  }
}

export async function searchLibrary(ownerId: string, { q, cursor, limit = 20, ...filters }: SearchInput) {
  const before = cursor ? decodeCursor(cursor) : undefined;
  const terms = q ? [...new Set(q.split(/\s+/u))] : [];
  const rows = await searchRows(ownerId, { ...filters, terms, before, limit: limit + 1 });
  const items = rows.slice(0, limit).map(({ solutionMatch, hasTechniques, ...row }) => {
    const fragment = row.attemptId ? `#attempt-${row.attemptId}` : solutionMatch ? "#final-answer" : "";
    return { ...row, ...(row.kind === "question" && { hasTechniques: Boolean(hasTechniques) }),
      href: `${paths[row.kind]}/${row.id}${fragment}`, matchSource: row.attemptId ? "attempt" : solutionMatch ? "solution" : null };
  });
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor({ kind: last.kind, updatedAt: last.updatedAt, id: last.id }) : null,
  };
}

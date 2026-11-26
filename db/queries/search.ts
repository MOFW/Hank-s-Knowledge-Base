import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, courses } from "@/db/schema";
import type { SearchCursor, SearchInput, SearchKind } from "@/domain/search";

type SearchFilters = Omit<SearchInput, "cursor" | "limit" | "q"> & {
  terms: string[];
  before?: SearchCursor;
  limit: number;
};

type SearchRow = SearchCursor & {
  title: string;
  rowVersion: number;
  hasTechniques: number | null;
  courseId: string;
  courseName: string;
  chapterId: string | null;
  chapterTitle: string | null;
  difficulty: number | null;
  mastery: SearchInput["mastery"] | null;
  attemptId: string | null;
  solutionMatch: number;
  excerpt: string;
};

const activeCourse = sql`c.deleted_at IS NULL AND c.archived_at IS NULL`;
const courseText = [sql`c.name`, sql`c.description_md`];
const topicText = [sql`t.title`, sql`t.summary_md`, sql`t.body_md`];
const solutionText = sql`coalesce(
  json_extract(q.solution_document_json, '$.bodyMd'),
  nullif(trim(q.final_answer_md, char(9, 10, 13, 32)), ''),
  (SELECT group_concat(json_extract(step.value, '$.bodyMd'), char(10))
    FROM json_each(q.solution_steps_json) AS step WHERE step.type = 'object')
)`;
const layeredSolutionText = sql`(SELECT group_concat(content.atom, char(10))
  FROM json_tree(q.solution_layers_json) AS content WHERE content.key IN ('title', 'markdown') AND content.type = 'text')`;
const questionText = [sql`q.title`, sql`q.statement_md`, solutionText, sql`q.key_techniques_md`, layeredSolutionText];
const attemptText = [sql`a.original_work_md`, sql`a.error_analysis_md`, sql`a.correction_md`, sql`a.insight_md`];

export function searchChapters() {
  return getDb().select({ id: chapters.id, courseId: chapters.courseId, parentId: chapters.parentId, title: chapters.title })
    .from(chapters).innerJoin(courses, eq(chapters.courseId, courses.id))
    .where(and(isNull(chapters.deletedAt), isNull(courses.deletedAt), isNull(courses.archivedAt)))
    .orderBy(chapters.sortOrder, chapters.id).all();
}

function containsAllTerms(fragments: SQL[], terms: string[]) {
  if (!terms.length) return sql`1`;
  const occurrences = fragments.map((text) => sql`coalesce(instr(lower(${text}), terms.word), 0) > 0`);
  return sql`NOT EXISTS (SELECT 1 FROM terms WHERE NOT (${sql.join(occurrences, sql` OR `)}))`;
}

function beforeRow(kind: SearchKind, updatedAt: SQL, id: SQL, before?: SearchCursor) {
  if (!before) return sql`1`;
  if (kind > before.kind) return sql`${updatedAt} <= ${before.updatedAt}`;
  if (kind < before.kind) return sql`${updatedAt} < ${before.updatedAt}`;
  return sql`(${updatedAt} < ${before.updatedAt} OR (${updatedAt} = ${before.updatedAt} AND ${id} > ${before.id}))`;
}

function coursesMatching(filters: SearchFilters) {
  const conditions = [activeCourse, beforeRow("course", sql`c.updated_at`, sql`c.id`, filters.before),
    containsAllTerms(courseText, filters.terms)];
  if (filters.courseId) conditions.push(sql`c.id = ${filters.courseId}`);
  return sql`
    SELECT 'course' AS kind, c.id, c.name AS title, c.updated_at,
      c.id AS course_id, c.name AS course_name, NULL AS chapter_id, NULL AS chapter_title,
      NULL AS difficulty, NULL AS mastery, NULL AS attempt_id
    FROM courses AS c WHERE ${and(...conditions)}
    ORDER BY c.updated_at DESC, c.id LIMIT ${filters.limit}`;
}

function topicsMatching(filters: SearchFilters) {
  const conditions = [activeCourse, sql`t.deleted_at IS NULL`, beforeRow("topic", sql`t.updated_at`, sql`t.id`, filters.before),
    containsAllTerms(topicText, filters.terms)];
  if (filters.courseId) conditions.push(sql`t.course_id = ${filters.courseId}`);
  if (filters.chapterId) conditions.push(sql`ch.id = ${filters.chapterId}`);
  if (filters.topicIds.length) conditions.push(sql`t.id IN (SELECT value FROM selected_topics)`);
  return sql`
    SELECT 'topic' AS kind, t.id, t.title, t.updated_at,
      c.id AS course_id, coalesce(c.name, '未归类') AS course_name, ch.id AS chapter_id, ch.title AS chapter_title,
      NULL AS difficulty, NULL AS mastery, NULL AS attempt_id
    FROM topics AS t LEFT JOIN courses AS c ON c.id = t.course_id
    LEFT JOIN chapters AS ch ON ch.id = t.chapter_id AND ch.deleted_at IS NULL
    WHERE ${and(...conditions)} ORDER BY t.updated_at DESC, t.id LIMIT ${filters.limit}`;
}

function linkedTopics(conditions: SQL[]) {
  return sql`
    FROM question_topics AS qt
    JOIN topics AS t ON t.id = qt.topic_id AND t.deleted_at IS NULL
    LEFT JOIN courses AS linked_course ON linked_course.id = t.course_id
    WHERE linked_course.deleted_at IS NULL AND linked_course.archived_at IS NULL AND qt.question_id = q.id AND ${and(...conditions)}`;
}

function questionFilters(filters: SearchFilters) {
  const conditions = [activeCourse, sql`q.deleted_at IS NULL`, beforeRow("question", sql`q.updated_at`, sql`q.id`, filters.before)];
  if (filters.courseId) {
    const primary = sql`q.primary_course_id = ${filters.courseId}`;
    conditions.push(filters.scope === "related"
      ? sql`(${primary} OR EXISTS (SELECT 1 ${linkedTopics([sql`t.course_id = ${filters.courseId}`])}))`
      : primary);
  }
  const chapter = filters.chapterId && sql`EXISTS (SELECT 1 FROM chapters AS ch
    WHERE ch.id = t.chapter_id AND ch.id = ${filters.chapterId} AND ch.deleted_at IS NULL)`;
  const selected = filters.topicIds.length ? sql`t.id IN (SELECT value FROM selected_topics)` : undefined;
  if (selected && filters.topicMode === "all") {
    conditions.push(sql`(SELECT count(*) ${linkedTopics([selected])}) = ${filters.topicIds.length}`);
  }
  if (chapter || (selected && filters.topicMode !== "all")) {
    const requiredLink = [chapter, selected].filter((condition): condition is SQL => Boolean(condition));
    conditions.push(sql`EXISTS (SELECT 1 ${linkedTopics(requiredLink)})`);
  }
  if (filters.difficulty !== undefined) conditions.push(sql`q.difficulty = ${filters.difficulty}`);
  if (filters.mastery) conditions.push(sql`ls.mastery = ${filters.mastery}`);
  if (filters.isMistake !== undefined) conditions.push(sql`ls.is_mistake = ${Number(filters.isMistake)}`);
  if (filters.dueBefore) conditions.push(sql`ls.next_review_on <= ${filters.dueBefore}`);
  return conditions;
}

function questionsMatching(ownerId: string, filters: SearchFilters) {
  const matchedAttempt = filters.terms.length ? sql`CASE WHEN ${containsAllTerms(questionText, filters.terms)} THEN '' ELSE (
    SELECT a.id FROM attempts AS a
    WHERE a.question_id = q.id AND a.user_id = ${ownerId} AND a.deleted_at IS NULL
      AND ${containsAllTerms([...questionText, ...attemptText], filters.terms)}
    ORDER BY a.created_at DESC, a.id DESC LIMIT 1
  ) END` : sql`''`;

  // An empty attempt ID represents a direct hit. NULL represents no text match.
  return sql`
    SELECT 'question' AS kind, matched.id, matched.title, matched.updated_at,
      matched.course_id, matched.course_name, NULL AS chapter_id, NULL AS chapter_title,
      matched.difficulty, matched.mastery, nullif(matched.matched_attempt, '') AS attempt_id
    FROM (
      SELECT q.id, q.title, q.updated_at, c.id AS course_id, coalesce(c.name, '未归类') AS course_name,
        q.difficulty, ls.mastery, ${matchedAttempt} AS matched_attempt
      FROM questions AS q LEFT JOIN courses AS c ON c.id = q.primary_course_id
      LEFT JOIN learning_states AS ls ON ls.question_id = q.id AND ls.user_id = ${ownerId} AND ls.deleted_at IS NULL
      WHERE ${and(...questionFilters(filters))}
    ) AS matched
    WHERE matched.matched_attempt IS NOT NULL ORDER BY matched.updated_at DESC, matched.id LIMIT ${filters.limit}`;
}

function joinedText(fragments: SQL[]) {
  return sql.join(fragments.map((fragment) => sql`coalesce(${fragment}, '')`), sql` || char(10) || `);
}

export async function searchRows(ownerId: string, filters: SearchFilters) {
  const questionOnly = filters.difficulty !== undefined || filters.mastery || filters.isMistake !== undefined || filters.dueBefore;
  const includes = (kind: SearchKind) => !filters.kind || filters.kind === kind;
  const branches = [];
  if (!questionOnly && includes("course") && !filters.chapterId && !filters.topicIds.length) branches.push(coursesMatching(filters));
  if (!questionOnly && includes("topic")) branches.push(topicsMatching(filters));
  if (includes("question")) branches.push(questionsMatching(ownerId, filters));
  if (!branches.length) return [];

  const combined = sql.join(branches.map((branch) => sql`SELECT * FROM (${branch})`), sql` UNION ALL `);
  // Fetch preview text only for the bounded page. Neither full notes nor attempt bodies leave D1.
  return getDb().all<SearchRow>(sql`
    WITH terms AS (SELECT lower(value) AS word FROM json_each(${JSON.stringify(filters.terms)})),
    selected_topics AS (SELECT value FROM json_each(${JSON.stringify(filters.topicIds)})),
    page AS MATERIALIZED (
      SELECT * FROM (${combined}) ORDER BY updated_at DESC, kind, id LIMIT ${filters.limit}
    ),
    previews AS MATERIALIZED (
      SELECT page.*, coalesce(c.row_version, t.row_version, q.row_version) AS row_version,
        trim(q.key_techniques_md) <> '' AS has_techniques,
        (page.kind = 'question' AND page.attempt_id IS NULL
          AND NOT ${containsAllTerms(questionText.slice(0, 2), filters.terms)}) AS solution_match,
        CASE page.kind WHEN 'course' THEN c.description_md
          WHEN 'topic' THEN ${joinedText(topicText.slice(1))}
          ELSE CASE WHEN page.attempt_id IS NOT NULL THEN ${joinedText(attemptText)}
            ELSE q.statement_md END
        END AS preview
      FROM page
      LEFT JOIN courses AS c ON page.kind = 'course' AND c.id = page.id
      LEFT JOIN topics AS t ON page.kind = 'topic' AND t.id = page.id
      LEFT JOIN questions AS q ON page.kind = 'question' AND q.id = page.id
      LEFT JOIN attempts AS a ON a.id = page.attempt_id
    ),
    snippets AS MATERIALIZED (
      SELECT previews.*, max(1, coalesce((SELECT min(nullif(instr(lower(preview), terms.word), 0)) FROM terms), 1) - 35) AS excerpt_start
      FROM previews
    )
    SELECT kind, id, title, row_version AS rowVersion, has_techniques AS hasTechniques,
      updated_at AS updatedAt, course_id AS courseId, course_name AS courseName,
      chapter_id AS chapterId, chapter_title AS chapterTitle, difficulty, mastery, attempt_id AS attemptId,
      solution_match AS solutionMatch,
      CASE WHEN solution_match THEN '' ELSE
        (CASE WHEN excerpt_start > 1 THEN '…' ELSE '' END) ||
        trim(replace(substr(preview, excerpt_start, 160), char(10), ' ')) ||
        (CASE WHEN length(preview) >= excerpt_start + 160 THEN '…' ELSE '' END)
      END AS excerpt
    FROM snippets ORDER BY updated_at DESC, kind, id`);
}

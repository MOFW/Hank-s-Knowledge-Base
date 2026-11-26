import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { attempts, courses, questions, topics } from "@/db/schema";

const activeCourse = and(isNull(courses.deletedAt), isNull(courses.archivedAt));

// Read-only projections; viewing a page never changes learning state.
export function recentTopics() {
  return getDb().select({
    id: topics.id, title: topics.title, courseName: sql<string>`coalesce(${courses.name}, '未归类')`.as("course_name"), updatedAt: topics.updatedAt,
  }).from(topics).leftJoin(courses, eq(topics.courseId, courses.id))
    .where(and(isNull(topics.deletedAt), activeCourse))
    .orderBy(desc(topics.updatedAt), topics.id).limit(5).all();
}

export function recentlyAttemptedQuestions(ownerId: string) {
  const lastAttemptAt = sql<string>`max(coalesce(${attempts.attemptedAt}, ${attempts.createdAt}))`;
  return getDb().select({
    id: questions.id, title: questions.title, courseName: sql<string>`coalesce(${courses.name}, '未归类')`.as("course_name"), lastAttemptAt,
    attemptCount: sql<number>`count(*)`,
  }).from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .leftJoin(courses, eq(questions.primaryCourseId, courses.id))
    .where(and(eq(attempts.userId, ownerId), isNull(attempts.deletedAt), isNull(questions.deletedAt), activeCourse))
    .groupBy(questions.id, questions.title, courses.name)
    .orderBy(desc(lastAttemptAt), questions.id).limit(4).all();
}

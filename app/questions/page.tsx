import { Suspense } from "react";
import { LoadingRows } from "@/components/route-loading";
import { GetForm } from "@/components/get-form";
import { AppLink } from "@/components/app-link";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { QuestionLinks } from "@/components/question-reading";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { questionListInput, type QuestionListInput } from "@/domain/questions";
import { chapterOptions } from "@/lib/directory";
import { OwnerPage } from "@/lib/owner-page";
import { getDirectory, listCourses } from "@/services/catalog";
import { listQuestions, listQuestionTopicChoices } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "题库" };

type Search = Record<string, string | string[] | undefined>;
const pageSize = 20;

function idFilter(value: Search[string]) {
  return idSchema.safeParse(value).data;
}

async function pageResult(ownerId: string, filters: QuestionListInput) {
  try {
    return { ...await listQuestions(ownerId, filters), hasCursor: Boolean(filters.cursor) };
  } catch (error) {
    if (!(error instanceof Problem) || error.code !== "INVALID_CURSOR") throw error;
    return { ...await listQuestions(ownerId, { ...filters, cursor: undefined }), hasCursor: false };
  }
}

async function QuestionFilters({ filters, courseId, chapterId, topicId, scope, isMistake, dueBefore }: {
  filters: URLSearchParams;
} & Pick<QuestionListInput, "courseId" | "chapterId" | "topicId" | "scope" | "isMistake" | "dueBefore">) {
  const [courses, directory, topics] = await Promise.all([
    listCourses(),
    courseId && courseId !== "unassigned" ? getDirectory(courseId) : null,
    listQuestionTopicChoices(),
  ]);
  return <GetForm key={filters.toString()} className="question-filters filter-body" action="/questions">
    <div className="filter-fields">
      <label>课程<select name="courseId" defaultValue={courseId ?? ""}>
        <option value="">全部课程</option>
        <option value="unassigned">未归类</option>
        {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
      </select></label>
      <label>课程范围<select name="scope" defaultValue={scope}>
        <option value="primary">主课程</option>
        <option value="related">主课程或关联知识点</option>
      </select></label>
      {directory && <label>章节<select name="chapterId" defaultValue={chapterId ?? ""}>
        <option value="">全部章节</option>
        {chapterOptions(directory.chapters).map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.label}</option>)}
      </select></label>}
      <label>知识点<select name="topicId" defaultValue={topicId ?? ""}>
        <option value="">全部知识点</option>
        {courses.map((course) => {
          const choices = topics.filter((topic) => topic.courseId === course.id);
          return choices.length > 0 && <optgroup key={course.id} label={course.name}>
            {choices.map((topic) => <option key={topic.id} value={topic.id}>{topic.chapterTitle ? `${topic.chapterTitle} / ` : ""}{topic.title}</option>)}
          </optgroup>;
        })}
      </select></label>
      <label>复习日期截至<input type="date" name="dueBefore" defaultValue={dueBefore ?? ""} /></label>
    </div>
    <div className="actions">
      <label className="check-field"><input type="checkbox" name="isMistake" value="true" defaultChecked={isMistake} />仅看错题</label>
      <button type="submit" className="button">筛选</button>
      {filters.size > 0 && <AppLink href="/questions" className="text-link">清除筛选</AppLink>}
    </div>
  </GetForm>;
}

async function QuestionResults({ request, filters, filteredPath }: {
  request: Promise<Awaited<ReturnType<typeof pageResult>>>;
  filters: URLSearchParams;
  filteredPath: string;
}) {
  const result = await request;
  const next = new URLSearchParams(filters);
  if (result.nextCursor) next.set("cursor", result.nextCursor);
  return <section className="section" aria-label="题目列表">
    <div className="section-head"><h2>{filters.size ? "筛选结果" : "全部题目"}</h2><span className="field-hint">本页 {result.items.length} 道 · 最近更新优先</span></div>
    <QuestionLinks items={result.items} preview empty={filters.size ? "没有符合条件的题目。" : "题库中还没有题目。"} />
    {(result.hasCursor || result.nextCursor) && <div className="actions pagination">
      {result.hasCursor && <AppLink className="button" href={filteredPath}>第一页</AppLink>}
      {result.nextCursor && <AppLink className="button" href={`/questions?${next}`}>下一页</AppLink>}
    </div>}
  </section>;
}

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const courseId = questionListInput.shape.courseId.safeParse(search.courseId).data;
  const chapterId = idFilter(search.chapterId);
  const topicId = idFilter(search.topicId);
  const scope = questionListInput.shape.scope.safeParse(search.scope).data ?? "primary";
  const isMistake = search.isMistake === "true" ? true : undefined;
  const dueBefore = questionListInput.shape.dueBefore.safeParse(search.dueBefore).data;
  const cursor = questionListInput.shape.cursor.safeParse(search.cursor).data;
  const filters = new URLSearchParams();
  if (courseId) filters.set("courseId", courseId);
  if (chapterId) filters.set("chapterId", chapterId);
  if (topicId) filters.set("topicId", topicId);
  if (scope === "related") filters.set("scope", scope);
  if (isMistake) filters.set("isMistake", "true");
  if (dueBefore) filters.set("dueBefore", dueBefore);
  const filteredPath = "/questions" + (filters.size ? `?${filters}` : "");
  const createParams = new URLSearchParams();
  if (courseId) createParams.set("courseId", courseId);
  if (topicId) createParams.set("topicId", topicId);
  const createPath = "/questions/new" + (createParams.size ? `?${createParams}` : "");

  return <OwnerPage returnTo={filteredPath}>
    {(ownerId) => {
      const result = pageResult(ownerId, { courseId, chapterId, topicId, scope, isMistake, dueBefore, cursor, limit: pageSize });
      return <div className="study-listing">
        <header className="page-head section-head">
          <h1>题库</h1>
          <div className="actions">
            <AppLink className="text-link" href="/questions/trash">题目回收站</AppLink>
            <AppLink className="text-link" href="/manage/assets">附件管理</AppLink>
            <AppLink className="text-link" href="/imports">导入审核</AppLink>
            <AppLink className="button primary" href={createPath}><Plus size={17} aria-hidden="true" />新增题目</AppLink>
          </div>
        </header>
        <div className="bank-toolbar">
          <GetForm className="quick-search bank-search" action="/search" role="search">
            <input type="hidden" name="kind" value="question" />
            {[...filters].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
            <label className="search-input-label"><span className="sr-only">搜索题目</span><Search size={18} aria-hidden="true" /><input type="search" name="q" placeholder="搜索题目、解题思路或知识关键词" maxLength={120} /></label>
            <button className="button" type="submit">搜索</button>
          </GetForm>
          <AppLink href="/review?category=mistakes" className="text-link">回顾错题</AppLink>
        </div>
        <details className="filter-disclosure" open={filters.size > 0 || undefined} suppressHydrationWarning>
          <summary><SlidersHorizontal size={16} aria-hidden="true" />筛选题目{filters.size > 0 && <span className="filter-active">已应用筛选</span>}</summary>
          <Suspense fallback={<div className="filter-body"><LoadingRows count={1} /></div>}>
            <QuestionFilters filters={filters} {...{ courseId, chapterId, topicId, scope, isMistake, dueBefore }} />
          </Suspense>
        </details>
        <Suspense fallback={<section className="section" aria-label="题目列表"><h2>{filters.size ? "筛选结果" : "全部题目"}</h2><LoadingRows /></section>}>
          <QuestionResults request={result} filters={filters} filteredPath={filteredPath} />
        </Suspense>
      </div>;
    }}
  </OwnerPage>;
}

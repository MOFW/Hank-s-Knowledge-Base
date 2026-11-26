import { Suspense } from "react";
import { LoadingRows } from "@/components/route-loading";
import { GetForm } from "@/components/get-form";
import { AppLink } from "@/components/app-link";
import { QuestionLinks } from "@/components/question-reading";
import { ReviewEntry } from "@/components/review-entry";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { Problem } from "@/domain/problem";
import { reviewCategory, reviewListInput, type ReviewCategory, type ReviewListInput } from "@/domain/review";
import { OwnerPage } from "@/lib/owner-page";
import { listCourses } from "@/services/catalog";
import { listQuestionTopicChoices, todayInTimezone } from "@/services/questions";
import { getReviewEntry, listReview } from "@/services/review";

export const dynamic = "force-dynamic";
export const metadata = { title: "复习中心" };

type Search = Record<string, string | string[] | undefined>;

const categories = {
  due: { title: "待复习", empty: "截至所选日期，没有符合条件的待复习题目。" },
  mistakes: { title: "错题", empty: "没有符合条件的错题。" },
  mastered: { title: "已掌握", empty: "没有符合条件的已掌握题目。" },
} satisfies Record<ReviewCategory, { title: string; empty: string }>;

function reviewPath(category: ReviewCategory, filters = new URLSearchParams(), cursor?: string | null) {
  const query = new URLSearchParams(filters);
  if (category !== "due") {
    query.set("category", category);
    query.delete("dueBefore");
  }
  if (cursor) query.set("cursor", cursor);
  return `/review${query.size ? `?${query}` : ""}`;
}

async function pageResult(ownerId: string, timezone: string, filters: ReviewListInput) {
  try {
    return { ...await listReview(ownerId, timezone, filters), hasCursor: Boolean(filters.cursor) };
  } catch (error) {
    if (!(error instanceof Problem) || error.code !== "INVALID_CURSOR") throw error;
    return { ...await listReview(ownerId, timezone, { ...filters, cursor: undefined }), hasCursor: false };
  }
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const category = reviewCategory.safeParse(search.category).data ?? "due";
  const courseId = reviewListInput.shape.courseId.safeParse(search.courseId).data;
  const topicId = reviewListInput.shape.topicId.safeParse(search.topicId).data;
  const dueBefore = category === "due" ? reviewListInput.shape.dueBefore.safeParse(search.dueBefore).data : undefined;
  const cursor = reviewListInput.shape.cursor.safeParse(search.cursor).data;
  const filters = new URLSearchParams();
  if (courseId) filters.set("courseId", courseId);
  if (topicId) filters.set("topicId", topicId);
  if (dueBefore) filters.set("dueBefore", dueBefore);
  const filteredPath = reviewPath(category, filters);
  const selected = categories[category];

  return <OwnerPage returnTo={filteredPath}>
    {(ownerId, timezone) => {
      const cutoff = category === "due" ? dueBefore ?? todayInTimezone(timezone) : undefined;
      const queueScope = category === "due" ? { courseId, topicId, dueBefore: cutoff } : {};
      async function ReviewContent() {
        const [courses, topicChoices, result, review] = await Promise.all([
          listCourses(),
          listQuestionTopicChoices(),
          pageResult(ownerId, timezone, { category, courseId, topicId, dueBefore: cutoff, scope: "related", cursor }),
          getReviewEntry(ownerId, timezone, queueScope),
        ]);
        const topicsByCourse = new Map<string | null, typeof topicChoices>();
        for (const topic of topicChoices) {
          const siblings = topicsByCourse.get(topic.courseId) ?? [];
          siblings.push(topic);
          topicsByCourse.set(topic.courseId, siblings);
        }
        const nextFilters = new URLSearchParams(filters);
        if (cutoff) nextFilters.set("dueBefore", cutoff);

        const firstQuestion = result.items[0];

        return <>
          <ReviewEntry entry={review} input={{ kind: "due", ...queueScope }} showHistory />
          {category === "due" && review.capped && <p className="field-hint review-queue-note">每轮最多 {review.due} 题，从日期最早的题开始。</p>}
          {category === "due" && !review.open && !review.due && firstQuestion && <p className="field-hint review-queue-note">已跳过的题在 24 小时后可再次进入待复习轮次。</p>}
          <details className="filter-disclosure" open={filters.size > 0 || undefined} suppressHydrationWarning>
            <summary><SlidersHorizontal size={16} aria-hidden="true" />调整复习范围{filters.size > 0 && <span className="filter-active">已应用筛选</span>}</summary>
          <GetForm key={filteredPath} className="question-filters filter-body" action="/review">
            {category !== "due" && <input type="hidden" name="category" value={category} />}
            <div className="filter-fields">
              <label>课程<select name="courseId" defaultValue={courseId ?? ""}>
                <option value="">全部课程</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select></label>
              <label>知识点<select name="topicId" defaultValue={topicId ?? ""}>
                <option value="">全部知识点</option>
                {courses.map((course) => {
                  const choices = topicsByCourse.get(course.id);
                  return choices && <optgroup key={course.id} label={course.name}>
                    {choices.map((topic) => <option key={topic.id} value={topic.id}>
                      {topic.chapterTitle ? `${topic.chapterTitle} / ${topic.title}` : topic.title}
                    </option>)}
                  </optgroup>;
                })}
              </select></label>
              {cutoff && <label>复习日期截至<input type="date" name="dueBefore" defaultValue={cutoff} /></label>}
            </div>
            <div className="actions">
              <button className="button" type="submit">筛选</button>
              {filters.size > 0 && <AppLink className="text-link" href={reviewPath(category)}>清除筛选</AppLink>}
            </div>
          </GetForm>
          </details>
          <section className="section" aria-label={selected.title}>
            <div className="section-head"><h2>{selected.title}题目</h2><span className="field-hint">{cutoff && <>截至 <time dateTime={cutoff}>{cutoff}</time> · </>}本页 {result.items.length} 道</span></div>
            <QuestionLinks items={result.items} preview empty={selected.empty} />
            {!firstQuestion && <AppLink className="text-link" href="/questions">浏览题库<ArrowRight size={16} aria-hidden="true" /></AppLink>}
            {(result.hasCursor || result.nextCursor) && <div className="actions pagination">
              {result.hasCursor && <AppLink className="button" href={filteredPath}>第一页</AppLink>}
              {result.nextCursor && <AppLink className="button" href={reviewPath(category, nextFilters, result.nextCursor)}>下一页</AppLink>}
            </div>}
          </section>
        </>;
      }

      return <div className="study-listing review-page">
        <header className="page-head"><h1>复习中心</h1></header>
        <nav className="review-tabs" aria-label="复习分类">
          {reviewCategory.options.map((item) => <AppLink key={item} href={reviewPath(item, filters)}
            className="review-tab" aria-current={item === category ? "page" : undefined}>
            {categories[item].title}
          </AppLink>)}
        </nav>
        <Suspense fallback={<LoadingRows />}><ReviewContent /></Suspense>
      </div>;
    }}
  </OwnerPage>;
}

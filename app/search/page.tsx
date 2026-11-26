import { Suspense } from "react";
import { LoadingRows } from "@/components/route-loading";
import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { ArrowRight, Search } from "lucide-react";
import { QuestionPreview } from "@/components/question-preview";
import { SearchForm } from "@/components/search-form";
import { Problem } from "@/domain/problem";
import { searchInput, searchParameters, type SearchInput, type SearchKind } from "@/domain/search";
import { chapterOptions } from "@/lib/directory";
import { masteryLabels } from "@/lib/learning-display";
import { OwnerPage } from "@/lib/owner-page";
import { searchFilterChoices, searchLibrary } from "@/services/search";

export const dynamic = "force-dynamic";
export const metadata = { title: "搜索" };

const kindLabels: Record<SearchKind, string> = { course: "课程", topic: "知识点", question: "题目" };

async function pageResults(ownerId: string, filters: SearchInput) {
  try {
    return { ...await searchLibrary(ownerId, filters), cursorValid: true };
  } catch (error) {
    if (!(error instanceof Problem) || error.code !== "INVALID_CURSOR") throw error;
    return { ...await searchLibrary(ownerId, { ...filters, cursor: undefined }), cursorValid: false };
  }
}

async function SearchResults({ request, cursor, first, firstPage }: {
  request: ReturnType<typeof pageResults>; cursor: string | undefined; first: URLSearchParams; firstPage: string;
}) {
  const results = await request;
  const next = new URLSearchParams(first);
  if (results.nextCursor) next.set("cursor", results.nextCursor);
  return <section className="section search-results" aria-labelledby="search-results-heading">
    <div className="section-head"><h2 id="search-results-heading">搜索结果</h2></div>
    {!results.cursorValid && <p className="field-hint">分页标记已失效，现显示第一页。</p>}
    {results.items.length ? <ul className="question-list">
      {results.items.map((item) => <li className="question-list-item" key={`${item.kind}:${item.id}`}>
        <AppLink href={item.href}>
          <div>
            <strong>{item.kind === "question" ? <QuestionTitle text={item.title} /> : item.title}</strong>
            <p>{kindLabels[item.kind]}{item.kind !== "course" && ` · ${item.courseName}`}
              {item.chapterTitle && ` · ${item.chapterTitle}`}{item.difficulty !== null && ` · 难度 ${item.difficulty}/5`}
              {item.mastery && ` · ${masteryLabels[item.mastery]}`}{item.matchSource === "attempt" && " · 作答记录命中"}
              {item.matchSource === "solution" && " · 解答或技巧命中"}</p>
            {item.excerpt && item.matchSource !== "solution" && item.matchSource !== "attempt" && <p className="search-excerpt">{item.excerpt}</p>}
          </div>
          <ArrowRight size={17} aria-hidden="true" />
        </AppLink>
        {item.excerpt && (item.matchSource === "solution" || item.matchSource === "attempt") && <details className="question-preview">
          <summary>查看匹配片段（可能包含解答）</summary><p className="question-preview-content search-excerpt">{item.excerpt}</p>
        </details>}
        {item.kind === "question" && <QuestionPreview id={item.id} />}
      </li>)}
    </ul> : <p className="empty">没有符合条件的结果。</p>}
    {((cursor && results.cursorValid) || results.nextCursor) && <nav className="actions pagination" aria-label="搜索结果分页">
      {cursor && results.cursorValid && <AppLink className="button" href={firstPage}>第一页</AppLink>}
      {results.nextCursor && <AppLink className="button" href={`/search?${next}`}>下一页</AppLink>}
    </nav>}
  </section>;
}

export default async function SearchPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : [value]) if (entry) params.append(name, entry);
  }
  const input = searchInput.safeParse(searchParameters(params));
  const filters = input.data ?? { topicIds: [] };
  const first = new URLSearchParams(input.success ? params : undefined);
  first.delete("cursor");
  const firstPage = `/search${first.size ? `?${first}` : ""}`;

  return <OwnerPage returnTo={firstPage}>{async (ownerId) => {
    const [courses, chapters, topics] = await searchFilterChoices();
    const results = input.success ? pageResults(ownerId, filters) : null;
    const selectedTopics = new Set(filters.topicIds);
    const advanced = Boolean(selectedTopics.size || filters.topicMode === "all" || filters.mastery
      || filters.isMistake !== undefined || filters.dueBefore);
    const filtered = advanced || Boolean(filters.kind || filters.courseId || filters.chapterId || filters.difficulty || filters.scope);

    return <div className="search-library">
      <header className="page-head"><h1>搜索</h1></header>
      <SearchForm key={params.toString()} className="search-form">
        <div className="library-search">
          <Search size={19} aria-hidden="true" />
          <label className="sr-only" htmlFor="search-keyword">关键词</label>
          <input id="search-keyword" type="search" name="q" defaultValue={filters.q ?? params.get("q") ?? ""} maxLength={120}
            placeholder="搜索笔记、题目或作答" aria-describedby="search-keyword-help" />
          <button type="submit" className="button">搜索</button>
        </div>
        <div className="search-options">
          <p className="field-hint" id="search-keyword-help">用空格分隔关键词，结果须匹配所有词。</p>
          {params.size > 0 && <AppLink className="text-link" href="/search">清除搜索条件</AppLink>}
        </div>
        <details className="filter-disclosure" open={filtered || undefined} suppressHydrationWarning>
          <summary>缩小搜索范围{filtered && <span className="filter-active">已应用筛选</span>}</summary>
          <div className="question-filters filter-body">
        <div className="filter-fields">
          <label>内容类型<select name="kind" defaultValue={filters.kind ?? ""}>
            <option value="">全部类型</option>
            {Object.entries(kindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
          </select></label>
          <label>课程<select name="courseId" defaultValue={filters.courseId ?? ""}>
            <option value="">全部课程</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
          </select></label>
          <label>题目课程范围<select name="scope" defaultValue={filters.scope === "related" ? "related" : ""}>
            <option value="">主课程</option>
            <option value="related">主课程或关联知识点</option>
          </select></label>
          <label>章节<select name="chapterId" defaultValue={filters.chapterId ?? ""}>
            <option value="">全部章节</option>
            {courses.map((course) => {
              const options = chapterOptions(chapters.filter((chapter) => chapter.courseId === course.id));
              return options.length ? <optgroup key={course.id} label={course.name}>
                {options.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.label}</option>)}
              </optgroup> : null;
            })}
          </select></label>
          <label>题目难度<select name="difficulty" defaultValue={filters.difficulty ?? ""}>
            <option value="">全部难度</option>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}
          </select></label>
        </div>
        <details className="choice-group" open={advanced || undefined} suppressHydrationWarning>
          <summary>知识点与学习状态筛选{selectedTopics.size > 0 && ` · 已选 ${selectedTopics.size} 个知识点`}</summary>
          <div className="question-filters panel-content">
            <div className="filter-fields">
              <label>掌握状态<select name="mastery" defaultValue={filters.mastery ?? ""}>
                <option value="">全部状态</option>
                {Object.entries(masteryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>错题标记<select name="isMistake" defaultValue={String(filters.isMistake ?? "")}>
                <option value="">全部题目</option>
                <option value="true">已标记错题</option>
                <option value="false">未标记错题</option>
              </select></label>
              <label>复习日期截至<input type="date" name="dueBefore" defaultValue={filters.dueBefore ?? ""} /></label>
              <label>题目知识点匹配<select name="topicMode" defaultValue={filters.topicMode === "all" ? "all" : ""}>
                <option value="">任一知识点</option>
                <option value="all">全部知识点</option>
              </select></label>
            </div>
            {topics.length > 0 && <fieldset className="topic-choices">
              <legend>选择知识点（最多 20 个）</legend>
              {courses.map((course) => {
                const choices = topics.filter((topic) => topic.courseId === course.id);
                return choices.length ? <details key={course.id} className="choice-group" suppressHydrationWarning
                  open={choices.some((topic) => selectedTopics.has(topic.id)) || undefined}>
                  <summary>{course.name}</summary>
                  <div className="search-topic-options" role="group" aria-label={`${course.name}的知识点`}>
                    {choices.map((topic) => <label key={topic.id} className="check-field">
                      <input type="checkbox" name="topicId" value={topic.id} defaultChecked={selectedTopics.has(topic.id)} />
                      <span>{topic.title}{topic.chapterTitle && <small>{topic.chapterTitle}</small>}</span>
                    </label>)}
                  </div>
                </details> : null;
              })}
            </fieldset>}
          </div>
        </details>
            <button className="button filter-submit" type="submit">应用筛选</button>
          </div>
        </details>
        {!input.success && <p className="error" role="alert">请检查关键词、筛选值和知识点选择数量。</p>}
      </SearchForm>
      {results && <Suspense fallback={<section className="section search-results"><h2>搜索结果</h2><LoadingRows /></section>}>
        <SearchResults request={results} cursor={filters.cursor} first={first} firstPage={firstPage} />
      </Suspense>}
    </div>;
  }}</OwnerPage>;
}

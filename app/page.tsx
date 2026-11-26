import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { ArrowRight, PenLine, Plus, Search } from "lucide-react";
import { OwnerPage } from "@/lib/owner-page";
import { HomeReading } from "@/components/reading-position";
import { ReviewEntry } from "@/components/review-entry";
import { SearchForm } from "@/components/search-form";
import { listCourses } from "@/services/catalog";
import { getReviewEntry, listReview } from "@/services/review";
import { todayInTimezone } from "@/services/questions";
import { recentTopics, recentlyAttemptedQuestions } from "@/db/queries/dashboard";
import { chatGPTSignOutPath } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default function Home() {
  return <OwnerPage returnTo="/">{async (ownerId, timezone) => {
    const dueBefore = todayInTimezone(timezone);
    const [courses, topics, recent, due, review] = await Promise.all([
      listCourses(), recentTopics(), recentlyAttemptedQuestions(ownerId),
      listReview(ownerId, timezone, { dueBefore, limit: 4 }), getReviewEntry(ownerId, timezone, { dueBefore }),
    ]);
    const date = (iso: string) => new Intl.DateTimeFormat("zh-CN", {
      timeZone: timezone, month: "short", day: "numeric",
    }).format(new Date(iso));

    return <div className="workbench">
      <header className="workbench-head">
        <h1>学习台</h1>
        <div className="actions workbench-actions">
          <details className="quick-note">
            <summary className="button"><PenLine size={15} aria-hidden="true" />写笔记</summary>
            <div className="quick-note-menu">
                <AppLink href="/topics/new">写未归类笔记</AppLink>
              <p className="field-hint">选择课程</p>
              {courses.map(course => <AppLink key={course.id} href={`/courses/${course.id}/topics/new`}>{course.name}<ArrowRight size={15} aria-hidden="true" /></AppLink>)}
              {!courses.length && <AppLink href="/courses">新增课程</AppLink>}
            </div>
          </details>
          <AppLink className="button" href="/questions/new"><Plus size={16} aria-hidden="true" />新增题目</AppLink>
        </div>
      </header>
      <SearchForm className="library-search workbench-search">
        <Search size={19} aria-hidden="true" />
        <label className="sr-only" htmlFor="home-search">搜索知识点、题目和作答</label>
        <input id="home-search" type="search" name="q" placeholder="搜索笔记、题目或作答" maxLength={120} required />
        <button className="button" type="submit">搜索</button>
      </SearchForm>
      <div className="workbench-grid">
        <div className="workbench-main">
          <HomeReading ownerId={ownerId} topics={topics.map(({ id, title, courseName, updatedAt }) => ({
            id, title, courseName, updatedAt, dateLabel: date(updatedAt),
          }))} courses={courses.map(({ id, name }) => ({ id, name }))} />
        </div>
        <aside className="workbench-side" aria-label="课程、复习与作答">
          <section className="workbench-section">
            <div className="section-head"><h2>课程</h2><AppLink className="text-link" href="/courses">全部课程 <ArrowRight size={14} aria-hidden="true" /></AppLink></div>
            {courses.length ? <ul className="workbench-courses">{courses.slice(0, 5).map(course => <li key={course.id}>
              <AppLink href={`/courses/${course.id}`}>{course.name}<ArrowRight size={15} aria-hidden="true" /></AppLink>
            </li>)}</ul> : <p className="empty">还没有课程。</p>}
          </section>
          <section className="workbench-section">
            <div className="section-head"><h2>待复习</h2><AppLink className="text-link" href="/review">复习中心 <ArrowRight size={14} aria-hidden="true" /></AppLink></div>
            <ReviewEntry entry={review} input={{ kind: "due", dueBefore }} />
            {due.items.length ? <ul className="review-shortlist">{due.items.map(item => <li key={item.id}><AppLink href={`/questions/${item.id}`}>
              <span className="activity-body"><strong><QuestionTitle text={item.title} /></strong><small>{item.courseName}</small></span>
              {item.nextReviewOn && <time dateTime={item.nextReviewOn}>{item.nextReviewOn.slice(5).replace("-", "/")}</time>}
            </AppLink></li>)}</ul> : null}
          </section>
          <section className="workbench-section recent-attempts">
            <div className="section-head"><h2>最近做过</h2></div>
            {recent.length ? <ul className="activity-list">{recent.map(item => <li key={item.id}><AppLink href={`/questions/${item.id}#attempts`}>
              <span className="activity-body"><strong><QuestionTitle text={item.title} /></strong><small>{item.courseName} · {item.attemptCount} 次作答</small></span><time dateTime={item.lastAttemptAt}>{date(item.lastAttemptAt)}</time>
            </AppLink></li>)}</ul> : <p className="empty">还没有作答记录。</p>}
          </section>
        </aside>
      </div>
      <footer className="site-footer"><a href={chatGPTSignOutPath()} target="_top">退出登录</a></footer>
    </div>;
  }}</OwnerPage>;
}

"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { ChapterPicker, type ChapterOption } from "./chapter-picker";
import { useRouteTransition } from "./route-transition";

export function CourseFilters({ courseId, chapters, query: initialQuery, chapterId }: {
  courseId: string; chapters: ChapterOption[]; query: string; chapterId: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const { navigate } = useRouteTransition();
  const path = `/courses/${courseId}`;
  function apply(chapter: string) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (chapter) params.set("chapterId", chapter);
    startTransition(() => navigate(params.size ? `${path}?${params}` : path, { scroll: false }));
  }

  return <div className="course-filters">
    <form className="quick-search" role="search" method="get" action={path} aria-busy={pending} onSubmit={(event) => {
      event.preventDefault();
      apply(chapterId);
    }}>
      <input type="search" name="q" aria-label="搜索课程笔记" placeholder="搜索笔记标题" maxLength={120} value={query}
        onChange={(event) => setQuery(event.target.value)} />
      {chapterId && <input type="hidden" name="chapterId" value={chapterId} />}
      <button type="submit" className="button"><Search size={16} aria-hidden="true" />搜索</button>
    </form>
    <ChapterPicker options={chapters} label="筛选章节" empty="全部章节" initial={chapterId}
      rootOption={{ id: "root", title: "课程根目录" }} onSelect={apply} />
    <span className="sr-only" role="status">{pending ? "正在更新笔记列表…" : ""}</span>
  </div>;
}

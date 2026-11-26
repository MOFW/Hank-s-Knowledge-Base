import { Search, SlidersHorizontal } from "lucide-react";

export function routeSection(path: string) {
  const [, section] = path.split("/");
  if (section === "topics") return "/courses";
  if (section === "attempts") return "/questions";
  return section ? `/${section}` : "/";
}

function routeLayout(path: string) {
  if (/^\/courses\/[^/]+\/read$/.test(path)) return { title: "课程阅读", kind: "note" };
  if (/^\/topics\/[^/]+$/.test(path) && !["/topics/new", "/topics/unassigned"].includes(path)) return { title: "笔记", kind: "note" };
  if (/^\/courses\/[^/]+$/.test(path) && path !== "/courses/deleted") return { title: "课程笔记", kind: "course" };
  switch (path) {
    case "/": return { title: "学习台", kind: "home", actions: ["写笔记", "新增题目"] };
    case "/questions": return { title: "题库", kind: "bank", actions: ["新增题目"] };
    case "/search": return { title: "搜索", kind: "search" };
    case "/courses": return { title: "课程目录", kind: "catalog", actions: ["未归类笔记", "添加笔记"] };
    case "/review": return { title: "复习中心", kind: "review" };
    case "/imports": return { title: "导入审核", kind: "imports", actions: ["DeepSeek 设置"] };
    default: {
      const section = routeSection(path);
      const title = section === "/courses" ? "笔记与课程" : section === "/questions" ? "题目" : section === "/review" ? "复习" : section === "/imports" ? "导入审核" : "知识库";
      return { title, kind: "detail" };
    }
  }
}

function PlaceholderSearch({ children }: { children: string }) {
  return <div className="library-search route-placeholder-search">
    <Search size={18} aria-hidden="true" /><span>{children}</span><span className="button">搜索</span>
  </div>;
}

export function LoadingRows({ count = 3 }: { count?: number }) {
  return <div className="route-placeholder-rows" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <div key={index}><span /><span /></div>)}
  </div>;
}

export function RouteLoading({ path, retry }: { path: string; retry?: () => void }) {
  const { title, kind, actions } = routeLayout(path);
  const catalog = kind === "catalog" || kind === "course";
  const listing = kind === "bank" || kind === "review";
  const className = catalog ? "catalog-page" : listing ? "study-listing" : kind === "note"
    ? "textbook-layout" : kind === "search" ? "search-library" : undefined;

  return <div className={className} data-route-placeholder={kind}>
    {kind === "course" && <div className="crumbs" aria-hidden="true">课程</div>}
    <header className={kind === "home" ? "workbench-head" : kind === "bank" || kind === "imports" ? "page-head section-head" : "page-head"}>
      <h1>{title}</h1>
      {!retry && actions && <div className="actions" aria-hidden="true">{actions.map((action) => <span key={action} className="button">{action}</span>)}</div>}
    </header>
    {retry ? <div className="route-error" role="alert"><p>页面暂时无法加载。</p><button type="button" className="button" onClick={retry}>重试</button></div> :
      <>
        <span className="sr-only" role="status">正在加载{title}</span>
        <div aria-hidden="true">
          {kind === "home" && <PlaceholderSearch>搜索知识点、题目和作答</PlaceholderSearch>}
          {kind === "bank" && <PlaceholderSearch>搜索题目、解题思路或知识关键词</PlaceholderSearch>}
          {kind === "search" && <PlaceholderSearch>输入关键词</PlaceholderSearch>}
          {kind === "review" && <div className="review-tabs"><span className="review-tab" aria-current="page">待复习</span><span className="review-tab">错题</span><span className="review-tab">已掌握</span></div>}
          {(listing || kind === "search") && <div className="route-placeholder-filter"><SlidersHorizontal size={16} />{kind === "bank" ? "筛选题目" : kind === "review" ? "调整复习范围" : "缩小搜索范围"}</div>}
          {kind === "course" && <h2>笔记</h2>}
          {kind === "bank" && <h2>全部题目</h2>}
          {kind === "review" && <h2>待复习题目</h2>}
          <LoadingRows />
        </div>
      </>}
  </div>;
}

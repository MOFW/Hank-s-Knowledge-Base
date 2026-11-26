export function chapterTree<T extends { id: string; parentId: string | null }>(chapters: T[]) {
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(chapters.map((chapter) => chapter.id));
  for (const chapter of chapters) {
    const parentId = chapter.parentId && ids.has(chapter.parentId) ? chapter.parentId : null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(chapter);
    byParent.set(parentId, siblings);
  }
  return byParent;
}

export function chapterOptions<T extends { id: string; parentId: string | null; title: string }>(chapters: T[]) {
  const tree = chapterTree(chapters);
  const result: { id: string; label: string; title: string; depth: number; parentId: string | null }[] = [];
  function visit(parentId: string | null, prefix: string, depth: number) {
    for (const chapter of tree.get(parentId) ?? []) {
      const label = prefix + chapter.title;
      result.push({ id: chapter.id, label, title: chapter.title, depth, parentId });
      visit(chapter.id, label + " / ", depth + 1);
    }
  }
  visit(null, "", 0);
  return result;
}

export function chapterTrail<T extends { id: string; parentId: string | null }>(chapters: T[], chapterId: string | null) {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const trail: T[] = [];
  for (let chapter = chapterId ? byId.get(chapterId) : undefined; chapter; chapter = byId.get(chapter.parentId ?? "")) {
    trail.unshift(chapter);
  }
  return trail;
}

type Branch<Chapter, Topic> = { chapter: Chapter; topics: Topic[]; children: Branch<Chapter, Topic>[] };

export function groupDirectory<Chapter extends { id: string; parentId: string | null }, Topic extends { chapterId: string | null }>(
  chapters: Chapter[], topics: Topic[],
) {
  const tree = chapterTree(chapters);
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const topicsByChapter = new Map<string | null, Topic[]>();
  for (const topic of topics) {
    const chapterId = topic.chapterId && ids.has(topic.chapterId) ? topic.chapterId : null;
    const group = topicsByChapter.get(chapterId) ?? [];
    group.push(topic);
    topicsByChapter.set(chapterId, group);
  }
  const orderedTopics: Topic[] = [];
  function group(parentId: string | null): Branch<Chapter, Topic>[] {
    return (tree.get(parentId) ?? []).map((chapter) => {
      const topics = topicsByChapter.get(chapter.id) ?? [];
      orderedTopics.push(...topics);
      return { chapter, topics, children: group(chapter.id) };
    });
  }
  const branches = group(null);
  const loose = topicsByChapter.get(null) ?? [];
  orderedTopics.push(...loose);
  return { branches, loose, orderedTopics };
}

export function chapterAnchor(chapterId: string | null) {
  return chapterId ? `chapter-${chapterId}` : "uncategorized";
}

export function chapterHref(courseId: string, chapterId: string | null) {
  const params = `?chapterId=${chapterId ?? "root"}`;
  return `/courses/${courseId}${params}#${chapterAnchor(chapterId)}`;
}

export function matchesDirectory(query: string, ...labels: string[]) {
  const text = labels.join(" ").normalize("NFKC").toLocaleLowerCase();
  return query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).every((term) => text.includes(term));
}

type ChapterLabel = { id: string; parentId: string | null; title: string };
type TopicLabel = { id: string; chapterId: string | null; title: string };

export type DirectoryEntry = {
  kind: "chapter" | "topic";
  id: string;
  title: string;
  path: string;
  depth: number;
  topicId?: string;
};

export function readingDirectory(chapters: ChapterLabel[], topics: TopicLabel[]) {
  const { branches, loose } = groupDirectory(chapters, topics);
  const entries: DirectoryEntry[] = [];
  function addNotes(notes: TopicLabel[], depth: number, path: string) {
    for (const note of notes) {
      entries.push({ kind: "topic", id: note.id, title: note.title, depth, path, topicId: note.id });
    }
  }
  function visit(items: typeof branches, depth: number, path: string) {
    let first: string | undefined;
    for (const { chapter, topics, children } of items) {
      const entry: DirectoryEntry = { kind: "chapter", id: chapter.id, title: chapter.title, depth, path };
      entries.push(entry);
      const childPath = path ? `${path} / ${chapter.title}` : chapter.title;
      addNotes(topics, depth + 1, childPath);
      const childStart = visit(children, depth + 1, childPath);
      entry.topicId = topics[0]?.id ?? childStart;
      first ??= entry.topicId;
    }
    return first;
  }
  visit(branches, 0, "");
  addNotes(loose, 0, "未分章");
  return entries;
}

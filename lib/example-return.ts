import { courseReadingHref, exampleAnchor, scopedId } from "./reading-anchor";

export type ExampleSource = { ownerId: string; courseId: string | null; topicId: string; questionId: string };
type ExampleVisit = ExampleSource & { top: number; opened: string[]; directoryOpen: boolean };
const historyKey = "hkbExampleVisit";
const storageKey = "hkb-example-visits";

export function exampleReturnHref(courseId: string | null, topicId: string, questionId?: string, visit?: string) {
  const anchor = questionId ? exampleAnchor(questionId) : "topic-start";
  const href = courseId ? courseReadingHref(courseId, topicId, anchor) : `/topics/${topicId}#${anchor}`;
  return visit ? href.replace("#", `${courseId ? "&" : "?"}readingVisit=${visit}#`) : href;
}

function savedVisits(): Array<[string, ExampleVisit]> {
  try {
    const visits = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(visits) ? visits : [];
  } catch { return []; }
}

export function rememberExample(source: ExampleSource, example: HTMLElement) {
  const root = example.closest(".continuous-stream, #topic-start");
  const opened = Array.from(root?.querySelectorAll<HTMLDetailsElement>("details[id][open]") ?? [], ({ id }) => id);
  const directoryOpen = Boolean(example.closest(".continuous-layout, .directory-layout")
    ?.querySelector('.reading-directory > button[aria-expanded="true"]'));
  const snapshot = { ...source, top: example.getBoundingClientRect().top, opened, directoryOpen };
  history.replaceState({ ...history.state, [historyKey]: snapshot }, "");
  const token = crypto.randomUUID();
  try {
    sessionStorage.setItem(storageKey, JSON.stringify([...savedVisits().slice(-23), [token, snapshot]]));
    return token;
  } catch { return undefined; }
}

export function readExampleVisit(ownerId: string, courseId: string | null, topicId?: string): ExampleVisit | undefined {
  const params = new URLSearchParams(location.search);
  const token = params.get("readingVisit");
  const inHistory = history.state?.[historyKey] as ExampleVisit | undefined;
  const storedToken = !inHistory && token && history.state?.hkbReturnedExample !== token;
  const visit = inHistory ?? (storedToken ? savedVisits().find(([key]) => key === token)?.[1] : undefined);
  if (!visit || visit.ownerId !== ownerId || visit.courseId !== courseId || (topicId && visit.topicId !== topicId) ||
      !Number.isFinite(visit.top) || !Array.isArray(visit.opened)) return;
  if (storedToken) {
    const anchor = exampleAnchor(visit.questionId);
    if (location.hash !== "#" + (courseId ? scopedId(visit.topicId, anchor) : anchor) ||
        (courseId && params.get("topicId") !== visit.topicId)) return;
  }
  return visit;
}

export function consumeExampleVisit() {
  if (!history.state?.[historyKey] && !new URLSearchParams(location.search).has("readingVisit")) return;
  const state = { ...history.state };
  delete state[historyKey];
  const token = new URLSearchParams(location.search).get("readingVisit");
  if (token) state.hkbReturnedExample = token;
  history.replaceState(state, "");
}

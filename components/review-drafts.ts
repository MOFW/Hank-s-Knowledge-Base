import type { ReviewSnapshot } from "@/services/review";

export type CachedReviewDraft = {
  key: string;
  position: number;
  version: number;
  text: string;
};

export function cachedReviewDrafts(prefix: string, review: ReviewSnapshot) {
  const drafts: CachedReviewDraft[] = [];
  if (!review.item || review.item.outcome) return drafts;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = JSON.parse(localStorage.getItem(key) ?? "null") as Omit<CachedReviewDraft, "key"> | null;
      if (value?.position === review.session.position && typeof value.text === "string" && value.text !== review.item.draftMd) {
        drafts.push({ key, ...value });
      }
    }
  } catch { /* The server draft remains available if browser storage is disabled. */ }
  return drafts;
}

export function storeReviewDraft(key: string, review: ReviewSnapshot, text: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ position: review.session.position, version: review.session.rowVersion, text }));
    return true;
  } catch { return false; }
}

export function draftPointer(prefix: string) {
  try { return sessionStorage.getItem(prefix); } catch { return null; }
}

export function pointToDraft(prefix: string, key: string) {
  try { sessionStorage.setItem(prefix, key); } catch { /* The draft can still be recovered explicitly. */ }
}

export function clearReviewDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* Browser storage may be disabled. */ }
}

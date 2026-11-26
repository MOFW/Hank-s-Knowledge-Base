export type BrowserNavigateEvent = Event & {
  navigationType: string;
  destination: { index: number; url: string; sameDocument: boolean };
};

export function browserNavigation() {
  return (window as Window & { navigation?: {
    currentEntry: { index: number };
    entries(): { url?: string }[];
  } & EventTarget }).navigation;
}

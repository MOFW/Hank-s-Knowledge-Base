"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { browserNavigation, type BrowserNavigateEvent } from "@/lib/browser-history";
import { useRouteTransition } from "./route-transition";

/** Keep drafts in the open editor; never write note content to browser storage. */
export function useUnsavedChanges() {
  const { navigate } = useRouteTransition();
  const changed = useRef(false);
  const leaving = useRef(false);
  const destination = useRef<string | number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  const title = useId();
  const description = useId();

  function markDirty() { changed.current = true; setDirty(true); }
  function markSaved() {
    changed.current = false;
    dialog.current?.close();
    setDirty(false);
  }
  function onFormChange(event: FormEvent<HTMLFormElement>) {
    if (event.target instanceof Element && event.target.closest("[data-ui-only]")) return;
    markDirty();
  }

  useEffect(() => {
    if (!dirty) return;
    const navigation = browserNavigation();
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!changed.current || leaving.current) return;
      event.preventDefault();
      event.returnValue = "";
    }
    function followLink(event: MouseEvent) {
      if (!changed.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const next = new URL(link.href, location.href);
      if (next.protocol !== "http:" && next.protocol !== "https:") return;
      if (next.origin === location.origin && next.pathname === location.pathname && next.search === location.search && next.hash) return;
      if (typeof dialog.current?.showModal !== "function") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      destination.current = link.hasAttribute("data-app-link") ? next.pathname + next.search + next.hash : next.href;
      dialog.current.showModal();
    }
    function restoreGuard() {
      leaving.current = false;
    }
    function beforeTraverse(event: Event) {
      const { navigationType, destination: target } = event as BrowserNavigateEvent;
      if (!changed.current || leaving.current || navigationType !== "traverse" || !target.sameDocument ||
          !event.cancelable || !navigation || !dialog.current) return;
      const next = new URL(target.url);
      if (next.pathname === location.pathname && next.search === location.search) return;
      event.preventDefault();
      destination.current = target.index - navigation.currentEntry.index;
      if (!dialog.current.open) dialog.current.showModal();
    }
    window.addEventListener("beforeunload", beforeUnload);
    navigation?.addEventListener("navigate", beforeTraverse);
    window.addEventListener("pageshow", restoreGuard);
    document.addEventListener("click", followLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      navigation?.removeEventListener("navigate", beforeTraverse);
      window.removeEventListener("pageshow", restoreGuard);
      document.removeEventListener("click", followLink, true);
    };
  }, [dirty]);

  function discardAndLeave() {
    const href = destination.current;
    if (!href) return;
    dialog.current?.close();
    // Suppress the browser prompt for this navigation after the user confirms.
    leaving.current = true;
    if (typeof href === "number") history.go(href);
    else if (href.startsWith("/")) navigate(href);
    else window.location.assign(href);
  }

  const confirmation = dirty ? createPortal(<dialog className="draft-dialog" ref={dialog}
    aria-labelledby={title} aria-describedby={description}>
    <h2 id={title}>放弃未保存的修改？</h2>
    <p id={description}>离开页面后，本次修改会丢失。</p>
    <div className="actions">
      <button className="button primary" type="button" onClick={() => dialog.current?.close()}>继续编辑</button>
      <button className="button danger" type="button" onClick={discardAndLeave}>放弃修改并离开</button>
    </div>
  </dialog>, document.body) : null;

  return { dirty, markDirty, markSaved, onFormChange, confirmation };
}

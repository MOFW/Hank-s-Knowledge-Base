"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useHydrated } from "./use-hydrated";

export function BrowseDialog({ title, trigger, triggerClass = "button", children }: {
  title: string; trigger: ReactNode; triggerClass?: string;
  children: (controls: { close: () => void; listRef: React.RefObject<HTMLDivElement | null> }) => ReactNode;
}) {
  const id = useId();
  const ready = useHydrated();
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useRef(false);
  const listOffset = useRef(0);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();

  function show() {
    const panel = dialog.current;
    if (!panel) return;
    panel.showModal();
    setOpen(true);
    const list = listRef.current;
    if (list) {
      if (shown.current) list.scrollTop = listOffset.current;
      else {
        const selected = list.querySelector<HTMLElement>('[aria-pressed="true"]');
        if (selected) {
          list.scrollTop = selected.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 3;
        }
      }
      shown.current = true;
    }
  }
  return <>
    <button className={triggerClass} type="button" disabled={!ready} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} ref={button} onClick={show}>{trigger}</button>
    <dialog className="browse-dialog" id={id} aria-labelledby={`${id}-title`} ref={dialog}
      onPointerDown={(event) => { if (event.target === dialog.current) close(); }}
      onClose={() => { setOpen(false); button.current?.focus({ preventScroll: true }); }}
      onScrollCapture={(event) => {
        if (dialog.current?.open && event.target === listRef.current) listOffset.current = listRef.current.scrollTop;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          close();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-browse-item]") ?? []);
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (index < 0 && (!(event.target instanceof HTMLInputElement) || !["ArrowDown", "ArrowUp"].includes(event.key))) return;
        if (!items.length) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : index < 0 ? items.length - 1 : Math.max(0, index - 1);
        items[next].focus();
      }}>
      <div className="browse-dialog-body">
        <header className="browse-dialog-head"><h2 id={`${id}-title`}>{title}</h2>
          <button className="icon-button" type="button" aria-label="关闭" onClick={close}><X size={20} aria-hidden="true" /></button>
        </header>
        {children({ close, listRef })}
      </div>
    </dialog>
  </>;
}

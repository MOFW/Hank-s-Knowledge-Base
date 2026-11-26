"use client";

import { useEffect } from "react";

function studyAnchor() {
  let id: string;
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return null; }
  const target = document.getElementById(id);
  return target?.closest(".question-study-layout") ? target : null;
}

export function QuestionStudyControls() {
  useEffect(() => {
    function reveal() {
      const target = studyAnchor();
      if (!target) return;
      const opened: HTMLDetailsElement[] = [];
      for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement && !parent.open) {
          parent.setAttribute("data-instant-disclosure", "");
          parent.open = true;
          opened.push(parent);
        }
      }
      const note = target.closest<HTMLElement>(".solution-note");
      if (note?.hidden) {
        const markerId = note.getAttribute("aria-labelledby");
        if (markerId) document.getElementById(markerId)?.click();
        requestAnimationFrame(() => {
          const revealed = studyAnchor() ?? note;
          revealed.scrollIntoView({ block: "start" });
          revealed.focus({ preventScroll: true });
        });
        opened.forEach((panel) => panel.removeAttribute("data-instant-disclosure"));
        return;
      }
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
      opened.forEach((panel) => panel.removeAttribute("data-instant-disclosure"));
    }
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  return null;
}

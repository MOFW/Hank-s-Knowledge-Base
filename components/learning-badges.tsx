"use client";

import { useEffect, useState } from "react";
import { masteryLabels } from "@/lib/learning-display";

export type LearningBadgeState = { mastery: keyof typeof masteryLabels; isMistake: boolean };
export const learningStateChanged = "hkb-learning-state-saved";

export function LearningBadges({ questionId, initial }: { questionId: string; initial: LearningBadgeState | null }) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    function update(event: Event) {
      const detail = (event as CustomEvent<{ questionId: string; state: LearningBadgeState }>).detail;
      if (detail.questionId === questionId) setState(detail.state);
    }
    window.addEventListener(learningStateChanged, update);
    return () => window.removeEventListener(learningStateChanged, update);
  }, [questionId]);
  return state && <>
    <span className="study-badge" data-mastery={state.mastery}>{masteryLabels[state.mastery]}</span>
    {state.isMistake && <span className="study-badge mistake">错题</span>}
  </>;
}

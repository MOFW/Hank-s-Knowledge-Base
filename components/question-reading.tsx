import { AppLink } from "@/components/app-link";
import { ArrowRight } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { QuestionTitle } from "@/components/question-title";
import { correctionAuthorLabels, masteryLabels } from "@/lib/learning-display";
import { QuestionPreview } from "@/components/question-preview";

export const difficultyLabels: Record<number, string> = { 1: "入门", 2: "基础", 3: "进阶", 4: "挑战", 5: "综合挑战" };

export function QuestionLinks({ items, empty, preview = false }: {
  items: {
    id: string;
    title: string;
    courseName: string;
    mastery: keyof typeof masteryLabels | null;
    isMistake: boolean | null;
    nextReviewOn: string | null;
    difficulty?: number | null;
  }[];
  empty: string;
  preview?: boolean;
}) {
  if (items.length === 0) return <p className="empty">{empty}</p>;
  return <ul className="question-list">
    {items.map((item) => <li key={item.id} className="question-list-item">
      <AppLink href={`/questions/${item.id}`}>
        <div>
          <strong><QuestionTitle text={item.title} /></strong>
          <p className="question-course">{item.courseName}{item.difficulty != null && ` · ${difficultyLabels[item.difficulty]} ${item.difficulty}/5`}</p>
          {(item.mastery || item.isMistake || item.nextReviewOn) && <div className="study-badges">
            {item.mastery && <span className="study-badge" data-mastery={item.mastery}>{masteryLabels[item.mastery]}</span>}
            {item.isMistake && <span className="study-badge mistake">错题</span>}
            {item.nextReviewOn && <span className="review-date">复习 <time dateTime={item.nextReviewOn}>{item.nextReviewOn}</time></span>}
          </div>}
        </div>
        <ArrowRight size={17} aria-hidden="true" />
      </AppLink>
      {preview && <QuestionPreview id={item.id} />}
    </li>)}
  </ul>;
}

export function OriginalQuestionImages({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return <div className="original-images">
    {ids.map((id, index) => <a key={id} className="original-image" href={`/api/v1/assets/${id}`}>
      {/* The protected file endpoint needs the browser's session. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/v1/assets/${id}`} alt={`原题图片 ${index + 1}`} loading="lazy" />
    </a>)}
  </div>;
}

export function AttemptNotes({ attempt }: { attempt: {
  originalWorkMd: string | null;
  errorAnalysisMd: string | null;
  correctionMd: string | null;
  insightMd: string | null;
  correctionAuthorKind: keyof typeof correctionAuthorLabels;
} }) {
  return <div className="attempt-notes">
    <section>
      <h3>原始思路</h3>
      {attempt.originalWorkMd?.trim()
        ? <Markdown source={attempt.originalWorkMd} />
        : <p className="empty">{attempt.originalWorkMd === null ? "未记录" : "原始记录为空"}</p>}
    </section>
    {attempt.errorAnalysisMd?.trim() && <section className="attempt-error"><h3>错误分析</h3><Markdown source={attempt.errorAnalysisMd} /></section>}
    {attempt.correctionMd?.trim() && <section>
      <h3>订正过程</h3>
      {attempt.correctionAuthorKind !== "unknown" && <p className="field-hint">订正作者 · {correctionAuthorLabels[attempt.correctionAuthorKind]}</p>}
      <Markdown source={attempt.correctionMd} />
    </section>}
    {attempt.insightMd?.trim() && <section className="attempt-insight"><h3>本次启发</h3><Markdown source={attempt.insightMd} /></section>}
  </div>;
}

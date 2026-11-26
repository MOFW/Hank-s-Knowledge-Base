import type { FeaturedExample as Example } from "@/domain/question-topic";
import { exampleAnchor, scopedId } from "@/lib/reading-anchor";
import { ChevronRight } from "lucide-react";
import { FeaturedExampleLink } from "./featured-example-link";
import { Markdown } from "./markdown";
import { QuestionTitle } from "./question-title";

export function FeaturedExample({ example, ownerId, courseId, topicId }: {
  example: Example; ownerId: string; courseId: string | null; topicId: string;
}) {
  const { questionId, title, statementMd, noteMd, techniquesMd, images } = example;
  const local = exampleAnchor(questionId);
  const id = courseId ? scopedId(topicId, local) : local;
  const usesTechniques = techniquesMd !== null;
  const analysis = (usesTechniques ? techniquesMd : noteMd).trim();
  return <section id={id} data-featured-example tabIndex={-1} className="featured-example" aria-labelledby={id + "-title"}>
    <p className="featured-example-title" id={id + "-title"}><span>例题</span><QuestionTitle text={title} /></p>
    {statementMd.trim() && <Markdown source={statementMd} />}
    {images.map(({ id, width, height, caption }, index) => {
      const href = `/api/v1/assets/${id}`;
      const label = caption || `原题图 ${index + 1}`;
      return <figure key={id} className="featured-example-figure">
        <a href={href} target="_blank" rel="noreferrer" aria-label={`打开${label}`}
          style={{ aspectRatio: width && height ? `${width} / ${height}` : "4 / 3" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- the protected original uses the browser session */}
          <img src={href} alt={label} loading="lazy" decoding="async" />
        </a>
        {caption && <figcaption>{caption}</figcaption>}
      </figure>;
    })}
    <div className="featured-example-actions">
      <FeaturedExampleLink source={{ ownerId, courseId, topicId, questionId }} />
      {(analysis || usesTechniques && noteMd.trim()) && <details id={id + "-analysis"} className="featured-example-disclosure" suppressHydrationWarning>
        <summary className="text-link"><ChevronRight size={15} aria-hidden="true" />
          <span className="example-expand-label">查看解题思路</span><span className="example-collapse-label">收起解题思路</span>
        </summary>
        <div className="featured-example-analysis">
          {usesTechniques && noteMd.trim() && <Markdown source={noteMd} />}
          {analysis && <Markdown source={analysis} />}
        </div>
      </details>}
    </div>
  </section>;
}

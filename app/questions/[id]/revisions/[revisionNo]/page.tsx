import { AppLink } from "@/components/app-link";
import { QuestionTitle } from "@/components/question-title";
import { notFound } from "next/navigation";
import { RevisionButton } from "@/components/revision-action";
import { RestoreRevision } from "@/components/learning-forms";
import { Markdown } from "@/components/markdown";
import { OriginalQuestionImages } from "@/components/question-reading";
import { SolutionReader } from "@/components/solution-reader";
import { idSchema } from "@/domain/catalog";
import type { SolutionDocument, SolutionStep } from "@/domain/solution";
import type { SolutionLayers } from "@/domain/solution-layers";
import { displayDateTime } from "@/lib/learning-display";
import { OwnerPage } from "@/lib/owner-page";
import { getQuestion, getQuestionRevision, listQuestionTopicChoices } from "@/services/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "题目历史版本" };

type Snapshot = {
  title: string;
  statementMd: string;
  finalAnswerMd: string;
  solutionDocument?: SolutionDocument | null;
  solutionLayers?: SolutionLayers | null;
  solutionSteps?: SolutionStep[];
  keyTechniquesMd: string;
  difficulty: number | null;
  sourceTitle: string | null;
  sourceLocator: string | null;
  sourceDate: string | null;
  deletedAt: string | null;
  topicIds: string[];
  originalAssetIds: string[];
};

export default async function QuestionRevisionPage({ params }: {
  params: Promise<{ id: string; revisionNo: string }>;
}) {
  const { id, revisionNo: raw } = await params;
  const questionPath = `/questions/${id}`;
  const base = questionPath + "/revisions";
  return <OwnerPage returnTo={`${base}/${raw}`}>
    {async (ownerId) => {
      const revisionNo = Number(raw);
      if (!idSchema.safeParse(id).success || !Number.isSafeInteger(revisionNo) || revisionNo < 1 || String(revisionNo) !== raw) notFound();
      const [question, revision, topics] = await Promise.all([
        getQuestion(id, ownerId, { includeDeleted: true }),
        getQuestionRevision(id, revisionNo),
        listQuestionTopicChoices(),
      ]);
      if (!question || !revision) notFound();
      const snapshot = revision.snapshotJson as Snapshot;
      const topicNames = new Map(topics.map((topic) => [topic.id, topic]));
      return <>
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/questions">题库</AppLink><span aria-hidden="true">/</span><AppLink href={base}>题目版本记录</AppLink>
        </nav>
        <article className="reading">
          <header className="reading-head">
            <h1><QuestionTitle text={snapshot.title} /></h1>
            <p className="version">版本 {revisionNo} · <time dateTime={revision.createdAt}>{displayDateTime(revision.createdAt)}</time>
              {snapshot.difficulty !== null && ` · 难度 ${snapshot.difficulty}/5`}{snapshot.deletedAt && " · 已删除"}
            </p>
          </header>
          {snapshot.statementMd.trim() && <Markdown source={snapshot.statementMd} />}
          <OriginalQuestionImages ids={snapshot.originalAssetIds} />
          {[snapshot.sourceTitle, snapshot.sourceLocator, snapshot.sourceDate].some(Boolean) && <div className="question-source">
            <h2>来源</h2><p>{[snapshot.sourceTitle, snapshot.sourceLocator, snapshot.sourceDate].filter(Boolean).join(" · ")}</p>
          </div>}
          {snapshot.topicIds.length > 0 && <section className="question-topics">
            <h2>关联知识点</h2>
            <ul className="topic-tags">{snapshot.topicIds.map((topicId) => {
              const topic = topicNames.get(topicId);
              return <li key={topicId}>{topic ? <AppLink href={`/topics/${topicId}`}>{topic.title}<small>{topic.courseName}</small></AppLink>
                : <span>已不可用的知识点</span>}</li>;
            })}</ul>
          </section>}
          {Boolean(snapshot.solutionDocument || snapshot.finalAnswerMd || snapshot.solutionSteps?.length || snapshot.solutionLayers || snapshot.keyTechniquesMd) &&
            <SolutionReader scope={`revision-${id}-${revisionNo}`} document={snapshot.solutionDocument} steps={snapshot.solutionSteps ?? []}
              topics={topics.filter(({ id }) => snapshot.topicIds.includes(id))} answerMd={snapshot.finalAnswerMd}
              layers={snapshot.solutionLayers} techniquesMd={snapshot.keyTechniquesMd} />}
          {revisionNo !== question.rowVersion && !snapshot.deletedAt && <RestoreRevision
            url={`/api/v1${questionPath}/restore`} version={question.rowVersion} revisionNo={revisionNo} returnTo={questionPath} />}
          <div className="actions"><RevisionButton base={base} action={{ action: "delete", revisionNo }} label="删除此版本"
            confirm="永久删除此历史快照？当前题目会保留。" notice="已删除历史版本" /></div>
        </article>
      </>;
    }}
  </OwnerPage>;
}

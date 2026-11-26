import type { committedLearningNotes } from "@/db/queries/imports";
import { sourcedNoteFields } from "@/domain/import-solution";
import type { EvidenceSnapshot, SolutionLayers, SolutionThread } from "@/domain/solution-layers";
import { AppLink } from "./app-link";
import { Markdown } from "./markdown";

const speakers = {
  learner: "学习者", assistant: "原助手", source_author: "原资料作者",
  new_ai: "AI 新增补充", owner: "人工补充", unknown: "发言者待核实",
};
const origins = {
  quoted: "原话", transcribed: "转录", source_summary: "据原资料整理",
  ai_generated: "AI 生成", owner: "人工编辑",
};

function SolutionEvidence({ evidence }: { evidence?: EvidenceSnapshot[] }) {
  if (!evidence?.length) return null;
  return <div className="solution-evidence">
    {evidence.map(({ sourceKey, sourceTitle, locator, quote, speaker, history }, index) => (
      <blockquote key={index}>
        <p>{quote}</p>
        <footer className="field-hint">{speakers[speaker]} · {sourceTitle ?? sourceKey} · {locator}
          {history && <details className="solution-evidence">
            <summary>档案定位</summary>
            <dl>{([
              ["档案指纹", history.location.digest], ["档案条目", history.location.entryPath], ["记录序号", history.location.ordinal],
              ["会话路径", history.location.conversationPath], ["节点路径", history.location.nodePath],
              ["消息路径", history.location.messagePath], ["原档角色", history.role],
            ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </details>}
        </footer>
      </blockquote>
    ))}
  </div>;
}

function threadSources(threads: SolutionThread[]) {
  return threads.flatMap(({ turns }) => turns.flatMap(({ learner, replies }) => [learner, ...replies]));
}

export function QuestionSolutionSources({ layers, importedNotes }: {
  layers: SolutionLayers | null;
  importedNotes: Awaited<ReturnType<typeof committedLearningNotes>>;
}) {
  const groups = layers ? [
    { id: "main", title: "主解答", texts: threadSources(layers.mainThreads) },
    ...layers.alternatives.map(({ id, title, body, threads }) => ({ id: `alternative-${id}`, title, texts: [body, ...threadSources(threads)] })),
    ...layers.supplements.map(({ id, title, body }) => ({ id: `supplement-${id}`, title, texts: [body] })),
  ].map((group) => ({ ...group, texts: group.texts.filter((text) => text.evidence?.length || text.speaker === "new_ai") }))
    .filter(({ texts }) => texts.length) : [];
  const legacy = importedNotes.flatMap(({ id, batchId, sources, annotations, learner_questions, evidenced_mistakes }) => {
    const evidence = [
      ...annotations.flatMap((annotation) => sourcedNoteFields.flatMap(([key, , label]) => {
        const text = annotation[key];
        return text?.evidence?.length ? [{ id: `annotation/${annotation.id}/${key}`, label, evidence: text.evidence }] : [];
      })),
      ...learner_questions.filter((entry) => entry.evidence.length).map(({ id, evidence }) => ({ id: `question/${id}`, label: "学习者疑问", evidence })),
      ...evidenced_mistakes.filter((entry) => entry.evidence.length).map(({ id, evidence }) => ({ id: `mistake/${id}`, label: "易错点", evidence })),
    ].map((entry) => ({
      ...entry, evidence: entry.evidence.map(({ source_key, ...item }) => ({
        sourceKey: source_key, sourceTitle: sources.find((source) => source.source_key === source_key)?.title, ...item,
      })),
    }));
    return batchId || evidence.length ? [{ id, batchId, evidence }] : [];
  });
  if (!groups.length && !legacy.length) return null;
  return <details className="question-solution-sources" suppressHydrationWarning>
    <summary>解答与追问的来源</summary>
    {groups.map(({ id, title, texts }) => <section key={id}>
      <h3>{title}</h3>
      {texts.map((text, index) => <div className="solution-source-entry" key={index}>
        <p className="solution-note-label">{speakers[text.speaker]} · {origins[text.origin]}</p>
        <Markdown source={text.markdown} />
        <SolutionEvidence evidence={text.evidence} />
      </div>)}
    </section>)}
    {legacy.length > 0 && <section>
      <h3>导入记录</h3>
      {legacy.map(({ id, batchId, evidence }) => <div className="solution-source-entry" key={id}>
        {evidence.map((entry) => <div key={entry.id}>
          <p className="solution-note-label">{entry.label}</p>
          <SolutionEvidence evidence={entry.evidence} />
        </div>)}
        {batchId && <AppLink className="text-link" href={`/imports/${batchId}#item-${id}`}>查看导入证据</AppLink>}
      </div>)}
    </section>}
  </details>;
}

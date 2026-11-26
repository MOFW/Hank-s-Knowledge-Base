import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { ManagementForm, type ManagementChoice } from "@/components/management-form";
import { QuestionTitle } from "@/components/question-title";
import { idSchema } from "@/domain/catalog";
import { managementKind, type ManagementKind } from "@/domain/management";
import { OwnerPage } from "@/lib/owner-page";
import { topicCourseChoices } from "@/services/catalog";
import { getManagement } from "@/services/management";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理资料" };

const labels: Record<ManagementKind, string> = {
  topic: "笔记", chapter: "章节", question: "题目", attempt: "作答记录",
  learning: "学习记录", batch: "导入批次", task: "长对话任务", "course-history": "旧课程档案",
};

export default async function ManagementPage({ params, searchParams }: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const path = await params;
  const kind = managementKind.safeParse(path.kind).data;
  const id = idSchema.safeParse(path.id).data;
  if (!kind || !id) notFound();
  const from = (await searchParams).from;
  return <OwnerPage returnTo={`/manage/${kind}/${id}`}>{async (ownerId) => {
    const plan = await getManagement(kind, id, ownerId);
    if (!plan) notFound();
    const courseHref = plan.courseId ? `/courses/${plan.courseId}` : "/topics/unassigned";
    const topicHref = `/topics/${id}${from === "edit" ? "/edit" : ""}`;
    const questionHref = `/questions/${id}`;
    const attemptHref = `/questions/${plan.questionId}#attempts`;
    const taskHref = `/imports/tasks/${id}`;
    const batchHref = `/imports/${id}`;
    let choices: ManagementChoice[];
    let cancelHref: string;
    let completeHref: string;
    switch (kind) {
      case "topic":
        cancelHref = topicHref;
        completeHref = courseHref;
        choices = [{ action: "delete", label: "删除笔记",
          description: "永久删除这篇笔记和历史版本，移除题目、知识点和来源关联。题目和其他笔记继续保留。" }];
        break;
      case "chapter":
        cancelHref = completeHref = courseHref;
        choices = [
          { action: "rename", label: "重命名章节", renameFrom: plan.title, description: "更新目录中的章节名称。" },
          { action: "keep", label: "删除章节，保留学习内容", placement: true,
            description: "移除该章节树，将笔记放入所选位置。题目的主课程、作答与复习记录保留。" },
          { action: "move", label: "移动章节树", placement: true,
            description: "连同子章节和笔记移动到目标位置。题目仍与这些笔记关联，可以在题库调整主课程。" },
          { action: "purge", label: "删除章节及专属内容", placement: true,
            description: "永久删除上面列出的可删除笔记、题目和历史。仍被外部资料关联的内容保留，保留的笔记放入所选位置。" },
        ];
        break;
      case "question":
        cancelHref = plan.inactiveSince ? "/questions/trash" : questionHref;
        completeHref = plan.inactiveSince ? "/questions/trash" : "/questions";
        choices = [
          ...(plan.inactiveSince ? [{ action: "restore" as const, label: "恢复题目",
            description: "恢复题目及其仍有效的关联、作答与版本。题目会重新出现在题库和搜索中。" }] : []),
          { action: "purge", label: "永久删除题目",
            description: "删除题目、题目版本、作答及该题复习记录。知识点和其他题目的资料继续保留。孤立图片可在附件页清理。" },
        ];
        break;
      case "attempt":
        cancelHref = from === "edit" ? `/attempts/${id}/edit` : attemptHref;
        completeHref = attemptHref;
        choices = [{ action: "delete", label: "删除这条作答", description: "删除这次作答、作答版本及来源关联。题目和复习进度继续保留。" }];
        break;
      case "learning":
        cancelHref = completeHref = questionHref;
        choices = [
          { action: "attempts", label: "清理此题作答",
            description: "删除此题的全部作答和作答版本。题目、掌握状态及复习计划继续保留。" },
          { action: "reset", label: "重置复习进度", description: "清除此题的复习记录、错题与掌握标记、复习日期。作答继续保留。" },
        ];
        break;
      case "batch":
        cancelHref = batchHref;
        completeHref = "/imports";
        choices = [
          ...(plan.items.length ? [{ action: "selected" as const, label: "删除所选候选", selectItems: true,
            description: "删除所选候选、原件中的对应条目和审核详情。正式资料及其已保存的来源继续保留。" }] : []),
          { action: "purge", label: "删除整个导入批次",
            description: "清除批次原件、候选、审核记录和任务中的批次链接。已入库的正式资料继续保留。" },
        ];
        break;
      case "course-history":
        cancelHref = completeHref = "/courses/deleted";
        choices = [{ action: "delete", label: "清理旧课程档案",
          description: "清理已删除课程的名称、正文和版本。已迁移的资料及历史版本仍会定位到当前归属。" }];
        break;
      case "task":
        cancelHref = taskHref;
        completeHref = "/imports";
        choices = [
          ...(!plan.inactiveSince ? [{ action: "cancel" as const, label: "取消任务",
            description: "停止继续向此任务保存进度或提交提案。已有草稿和导入批次继续可查看。" }] : []),
          { action: "delete", label: "删除任务", description: "删除任务、检查点、草稿和临时证据。已有导入批次及正式资料继续保留。" },
        ];
        break;
    }
    const courses = kind === "chapter" ? (await topicCourseChoices()).map((course) => ({
      ...course, chapters: course.chapters.filter((chapter) => !plan.scope?.chapters.includes(chapter.id)),
    })) : [];
    return <div className="catalog-page">
      <nav className="crumbs" aria-label="当前位置"><AppLink href={cancelHref}>返回{labels[kind]}</AppLink></nav>
      <header className="page-head"><h1>管理{labels[kind]}</h1><p><QuestionTitle text={plan.title} /></p></header>
      {Object.keys(plan.counts).length > 0 && <div className="actions">
        {Object.entries(plan.counts).map(([label, count]) => <span key={label}>{label} {count}</span>)}
      </div>}
      <section className="panel">
        <ManagementForm url={`/api/v1/management/${kind}/${id}`} dataEpoch={plan.dataEpoch}
          cancelHref={cancelHref} completeHref={completeHref} choices={choices} items={plan.items}
          courses={courses} initialCourseId={plan.courseId} />
      </section>
    </div>;
  }}</OwnerPage>;
}

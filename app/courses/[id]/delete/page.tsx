import { AppLink } from "@/components/app-link";
import { notFound } from "next/navigation";
import { CourseDeletionForm } from "@/components/course-deletion-form";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { getCourseDeletionPlan } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "删除课程" };

export default async function CourseDeletionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OwnerPage returnTo={`/courses/${id}/delete`}>
    {async (ownerId) => {
      if (!idSchema.safeParse(id).success) notFound();
      const plan = await getCourseDeletionPlan(id, ownerId);
      if (!plan) notFound();
      const { course, dataEpoch, chapters, topics, questions } = plan;
      const hasContent = chapters + topics + questions > 0;
      return <div className="catalog-page">
        <nav className="crumbs" aria-label="当前位置">
          <AppLink href="/courses">课程</AppLink><span aria-hidden="true">/</span><AppLink href={`/courses/${id}`}>{course.name}</AppLink>
        </nav>
        <header className="page-head"><h1>删除课程「{course.name}」</h1></header>
        <section className="panel panel-content" aria-labelledby="course-deletion-impact">
          <h2 id="course-deletion-impact">关联内容</h2>
          <p>章节 {chapters} 个 · 知识点 {topics} 个 · 主课程题目 {questions} 道（含已删除题目的历史记录）</p>
          {plan.candidates > 0 && <p>引用原课程的候选可在审核页重新选择归属。</p>}
          <p><strong>删除课程后无法撤销。</strong></p>
          <CourseDeletionForm id={id} dataEpoch={dataEpoch} hasContent={hasContent}
            exclusive={{ notes: plan.exclusiveTopics, questions: plan.exclusiveQuestions }} />
        </section>
      </div>;
    }}
  </OwnerPage>;
}

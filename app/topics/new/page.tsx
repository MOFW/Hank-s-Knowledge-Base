import { TopicEditor } from "@/components/catalog-forms";
import { OwnerPage } from "@/lib/owner-page";
import { topicCourseChoices } from "@/services/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "添加笔记" };

export default function NewNote() {
  return <OwnerPage returnTo="/topics/new">{async () => <>
    <header className="page-head"><h1>添加笔记</h1></header>
    <TopicEditor courseId={null} chapters={[]} courses={await topicCourseChoices()} />
  </>}</OwnerPage>;
}

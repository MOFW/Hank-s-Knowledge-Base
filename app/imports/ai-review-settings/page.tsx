import { AppLink } from "@/components/app-link";
import { AiReviewSettings } from "@/components/ai-review-settings";
import { OwnerPage } from "@/lib/owner-page";
import { getReviewSettings } from "@/services/ai-review";
import "@/components/imports.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "DeepSeek 审核设置" };

export default function Page() {
  return <OwnerPage returnTo="/imports/ai-review-settings">{async (ownerId) => <div className="import-workspace">
    <nav className="crumbs" aria-label="当前位置"><AppLink href="/imports?legacy=1">旧导入</AppLink></nav>
    <header className="page-head"><h1>DeepSeek 审核设置</h1></header>
    <AiReviewSettings initial={await getReviewSettings(ownerId)} />
  </div>}</OwnerPage>;
}

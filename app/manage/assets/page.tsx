import { AppLink } from "@/components/app-link";
import { AssetCleanup } from "@/components/asset-cleanup";
import { idSchema } from "@/domain/catalog";
import { OwnerPage } from "@/lib/owner-page";
import { assetManagement } from "@/services/asset-cleanup";

export const dynamic = "force-dynamic";
export const metadata = { title: "附件管理" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const before = idSchema.safeParse((await searchParams).before).data;
  return <OwnerPage returnTo="/manage/assets">{async (ownerId) => {
    const data = await assetManagement(ownerId, before);
    return <div className="catalog-page">
      <nav className="crumbs" aria-label="当前位置"><AppLink href="/questions">题库</AppLink></nav>
      <header className="page-head"><h1>附件管理</h1></header>
      <p>可以删除未使用的图片，也可以确认从所有列出的资料中移除附件后删除。仅用于历史版本的图片可以直接清理。</p>
      <AssetCleanup dataEpoch={data.dataEpoch} rows={data.rows} />
      <div className="actions">
        {before && <AppLink className="button" href="/manage/assets">返回第一页</AppLink>}
        {data.next && <AppLink className="button" href={`/manage/assets?before=${data.next}`}>更早的附件</AppLink>}
      </div>
    </div>;
  }}</OwnerPage>;
}

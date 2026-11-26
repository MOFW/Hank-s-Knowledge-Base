import { getAssetStore } from "@/adapters/assets";
import { idSchema } from "@/domain/catalog";
import { Problem } from "@/domain/problem";
import { api, privateHeaders } from "@/lib/http";
import { getAsset, imageMime } from "@/services/assets";

type Route = { params: Promise<{ id: string }> };

export const GET = api<Route>(async (request, { ownerId }, { params }) => {
  const id = idSchema.parse((await params).id);
  const asset = await getAsset(id, ownerId);
  if (!asset) throw new Problem(404, "NOT_FOUND", "找不到这张图片。");
  const object = await getAssetStore().get(asset.storageKey);
  if (!object) throw new Problem(503, "ASSET_UNAVAILABLE", "暂时无法读取原图，请稍后重试。");
  const encodedName = encodeURIComponent(asset.originalFilename)
    .replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new Response(object.body, {
    headers: {
      ...privateHeaders,
      "Content-Type": imageMime(asset.mimeType),
      "Content-Length": String(object.size),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});

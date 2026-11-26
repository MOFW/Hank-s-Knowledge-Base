import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createFirstOwner } from "@/db/queries/owner-setup";
import { Problem } from "@/domain/problem";
import { privateHeaders, readBody, requireWriteOrigin } from "@/lib/http";
import { matchesOwnerSetupCode, ownerSetupConfig } from "@/lib/owner-setup";

function message(status: number, text: string) {
  return new Response(text, { status, headers: { ...privateHeaders, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const config = ownerSetupConfig();
  if (!config) return message(404, "此页面不可用。");

  try {
    if (new URL(request.url).origin !== config.origin) {
      return message(403, "请从本站的所有者设置页提交。");
    }
    requireWriteOrigin(request);

    // Only the identity injected by Sites Dispatch supplies the owner subject.
    const user = await getChatGPTUser();
    if (!user) return message(401, "请先登录 ChatGPT。");

    const contentType = request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") return message(415, "请使用所有者设置表单。");

    const form = new URLSearchParams(await readBody(request, 512));
    const code = form.get("code");
    if (form.size !== 1 || !code || !matchesOwnerSetupCode(code, config.digest)) {
      return message(403, "设置码无效。");
    }
    if (!(await createFirstOwner(config.scope, user.userId))) {
      return message(409, "知识库已初始化或数据库并非空库。");
    }

    return new Response(null, { status: 303, headers: { ...privateHeaders, Location: "/" } });
  } catch (error) {
    if (error instanceof Problem) return message(error.status, error.message);
    return message(500, "暂时无法完成所有者绑定。");
  }
}

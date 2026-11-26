import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import { ownerSetupIsAvailable } from "@/db/queries/owner-setup";
import { privateHeaders } from "@/lib/http";
import { ownerSetupConfig } from "@/lib/owner-setup";

const form = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>绑定知识库所有者</title>
  </head>
  <body>
    <main>
      <h1>绑定知识库所有者</h1>
      <p>确认你已登录要用于管理知识库的 ChatGPT 账户，然后输入一次性设置码。</p>
      <form method="post" action="/api/v1/owner-setup" autocomplete="off">
        <label>设置码 <input type="password" name="code" minlength="43" maxlength="43" required></label>
        <button type="submit">绑定当前账户</button>
      </form>
    </main>
  </body>
</html>`;

export async function GET(request: Request) {
  const config = ownerSetupConfig();
  if (!config || new URL(request.url).origin !== config.origin) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }
  if (!(await getChatGPTUser())) {
    return new Response(null, {
      status: 303, headers: { ...privateHeaders, Location: chatGPTSignInPath("/owner-setup") },
    });
  }
  if (!(await ownerSetupIsAvailable())) {
    return new Response(null, { status: 404, headers: privateHeaders });
  }

  return new Response(form, {
    headers: {
      ...privateHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

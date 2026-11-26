import type { ReactNode } from "react";
import { resolveOwner } from "@/adapters/identity";
import { chatGPTSignInPath, chatGPTSignOutPath } from "@/app/chatgpt-auth";

export async function OwnerPage({ returnTo, children }: {
  returnTo: string; children: (ownerId: string, timezone: string) => ReactNode | Promise<ReactNode>;
}) {
  const access = await resolveOwner();
  if (access.status === "owner") return children(access.owner.id, access.owner.timezone);
  const signInLabel = import.meta.env.DEV ? "使用本地开发身份进入" : "使用 ChatGPT 登录";
  return (
    <section className="gate">
      <h1>{access.status === "anonymous" ? "登录知识库" : "此账户没有访问权限"}</h1>
      <p>{access.status === "anonymous" ? "登录后可查看课程、笔记和题库。" : "请切换到已绑定的所有者账户。"}</p>
      {access.status === "anonymous"
        ? <a className="button primary" href={chatGPTSignInPath(returnTo)} target="_top">{signInLabel}</a>
        : <a className="button" href={chatGPTSignOutPath(returnTo)} target="_top">退出登录</a>}
    </section>
  );
}

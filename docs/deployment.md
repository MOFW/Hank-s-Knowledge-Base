# Sites deployment and MCP / Sites 部署与 MCP

Create your own private Site and independent D1 and R2 resources through Sites. The hosting file declares binding names and MCP capability, and deliberately contains no project ID. Use the current Sites workflow to associate the project with your own Site; do not reuse another person's project or storage. Platform availability and provisioning have not been verified for this candidate.

Set `HKB_SITE_SCOPE` to your Site ID and `HKB_MCP_SITE_ORIGIN` to the exact HTTPS origin. Generate a random setup code and its SHA-256 hash locally with:

```sh
node -e "const {randomBytes,createHash}=require('node:crypto'); const code=randomBytes(32).toString('base64url'); console.log(code); console.log(createHash('sha256').update(code).digest('hex'))"
```

Store the hash as the Sites secret `HKB_OWNER_SETUP_CODE_HASH`. Apply all migrations to the new empty D1 through the platform deployment flow. Sign in as the Site owner at `/owner-setup` and enter the original code. Remove the setup secret and redeploy the same source; verify the owner mapping and that other users cannot read or write. Connect the Site's own plugin in ChatGPT. A Site must be behind Sites dispatch: its authenticated identity headers are trusted only at that boundary. Never expose the production worker directly with forgeable identity headers. Restrict Site access to the owner.

`DEEPSEEK_API_KEY` is optional. Local MCP protocol testing uses a random `HKB_MCP_TOKEN` and `HKB_MCP_OWNER_SUBJECT=local_seedy`; do not reuse those development values in production. MCP can write and delete data: verify access restrictions and use a separate instance per deployment. Consult [Sites data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections) and [Sites management](https://learn.chatgpt.com/docs/sites/managing-a-site) for current platform steps.

创建自己的私有 Site、独立 D1 和 R2。配置中的绑定名保留，项目 ID 由自己的平台流程关联。设置 `HKB_SITE_SCOPE` 和精确的 HTTPS `HKB_MCP_SITE_ORIGIN`，以上命令生成一次性设置码与哈希；把哈希作为 `HKB_OWNER_SETUP_CODE_HASH` 秘密配置，在新空库应用全部迁移。以 Site 所有者登录 `/owner-setup` 输入原码，完成后移除秘密并重新部署同一源码，验证 owner 映射和未授权拒绝，再连接自己的插件。生产 Worker 必须位于 Sites 分发层之后，限制访问为 owner。DeepSeek 可选。本地 MCP 凭据只用于本地测试。候选尚未在独立 Sites 资源上验证，平台步骤可能变化。

The current Sites developer workflow registers a new private Site first, then writes the returned project ID into `.openai/hosting.json`, pushes that Site's source, builds, and deploys the matching version. A manifest without `project_id` is a template, not a deployable association. The platform's D1 migration/provisioning and owner setup have not yet been verified on a new instance; do not treat these instructions as an independently tested deployment recipe.

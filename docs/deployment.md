# Sites deployment and MCP / Sites 部署与 MCP

## English

HKB targets a private ChatGPT Site. Access to Sites and MCP depends on account and platform permissions. Start with your own new Site; do not reuse another deployment's project ID, D1, R2 or secrets.

1. Register a private Site through the current Sites workflow. Insert the returned `project_id` into `.openai/hosting.json`, preserving `d1: DB`, `r2: BUCKET`, and the `mcp` capability. The checked-in manifest is a template and cannot associate a deployment on its own. Push the Site-specific source to that Site's source repository, build it, and deploy its matching version. Sites provisions the bindings and applies migrations before uploading the Worker. Do not run the local demo seed on the hosted database.
2. Set `HKB_SITE_SCOPE` to the exact Site project ID and `HKB_MCP_SITE_ORIGIN` to its exact HTTPS origin. Generate a random one-time setup code and its SHA-256 hash locally:

   ```sh
   node -e "const {randomBytes,createHash}=require('node:crypto'); const code=randomBytes(32).toString('base64url'); console.log(code); console.log(createHash('sha256').update(code).digest('hex'))"
   ```

   Store only the hash in the Sites secret `HKB_OWNER_SETUP_CODE_HASH`; deploy to apply environment changes. Keep the original code private.
3. Sign in with the intended owner account at `/owner-setup` and enter the code. Remove the setup secret and redeploy the same version. Verify owner access and rejection of other users. Restrict the Site to the owner. Connect the Site's own MCP app in ChatGPT and verify read and write with disposable data. MCP can modify and delete data.
4. `DEEPSEEK_API_KEY` is optional. The local MCP token and `local_seedy` identity are only for local testing. The hosted Worker must stay behind Sites dispatch, the boundary that supplies trusted identity headers; never expose it directly with forgeable identity headers.

**Verification scope:** An independent snapshot passed clean local installation, build, empty D1 migrations, startup and basic MCP read/write tests. A separate owner-private Site deployed the snapshot with only its own project ID added. Its first deployment succeeded with MCP capability, ChatGPT sign-in and one-time owner binding succeeded, and the home page showed an empty course list. Hosted MCP read/write and independent unauthorized-user rejection were not verified. Platform workflow and availability may change; consult [Sites data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections) and [Sites management](https://learn.chatgpt.com/docs/sites/managing-a-site).

## 中文

HKB 面向私有 ChatGPT Site，Sites 和 MCP 的可用性取决于账号与平台权限。创建自己的独立站点、D1、R2 和秘密配置，切勿复用其他部署的项目 ID 或存储。

1. 按当前 Sites 工作流创建私有站点，将返回的 `project_id` 填入 `.openai/hosting.json`，保留 `DB`、`BUCKET` 和 `mcp` 声明。仓库中的 manifest 是模板，不能自行关联站点。将站点专用源码推送到该站源码仓库，构建并部署对应版本。Sites 配置资源并在上传 Worker 前执行迁移。不要在托管数据库运行本地演示 seed。
2. 将 `HKB_SITE_SCOPE` 设置为该站项目 ID，`HKB_MCP_SITE_ORIGIN` 设置为完整 HTTPS origin。运行上面的命令生成随机一次性设置码及 SHA-256 哈希；只将哈希写入 Sites Secret `HKB_OWNER_SETUP_CODE_HASH`，部署使配置生效，并妥善保管原码。
3. 使用目标所有者账户登录 `/owner-setup` 并输入原码。删除设置 Secret，重新部署同一版本。验证所有者可访问及其他用户被拒绝，限制站点仅所有者访问。将该站自己的 MCP 应用连接到 ChatGPT，使用临时数据验证读写。MCP 可以修改及删除数据。
4. `DEEPSEEK_API_KEY` 可选。本地 MCP token 与 `local_seedy` 仅供本机测试。托管 Worker 必须位于提供可信身份头的 Sites 分发层之后，不可直接暴露可伪造身份头的 Worker。

**验证范围：** 独立快照已通过本地全新安装、构建、空 D1 迁移、启动及 MCP 基本读写。另建的所有者私有 Site 以该快照加自己的项目 ID 部署成功，平台报告 MCP 已启用，ChatGPT 登录与一次性 owner 绑定成功，首页显示空课程。托管 MCP 读写和另一用户的拒绝访问尚未验证。平台流程与可用性可能变化，参阅上方 Sites 官方文档。

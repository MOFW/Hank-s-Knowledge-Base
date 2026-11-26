# Hank’s Knowledge Base

[English](README.md)

HKB 是面向 ChatGPT 学习场景的个人知识库，把学习对话整理成可连续阅读的教材式笔记、例题和交互式解答。像教材一样连续阅读，像老师一样分层解释，像笔记本一样自由积累。

课程支持连续阅读和完整目录；知识点可融入精选例题，解答支持数学推导、独立的其他解法和原地展开的追问。ChatGPT 通过 MCP 整理、编辑和删除资料，并可撤销最近一轮。支持 Markdown、LaTeX、代码、附件和私人学习记录。

例如说「把刚才聊的整理进去」「把这个追问加到之前那道题里」「这个解法也记下来」「撤销刚才的修改」。

项目针对 ChatGPT、Codex 和 ChatGPT Sites 设计，以个人使用为主；平台功能取决于账户及权限，不承诺支持其他 AI 客户端或托管环境。DeepSeek 审核是可选功能。

## 开始使用

需要 Node.js 22.13 或更新版本及 npm。依次运行 `npm run install:ci`、`npm run db:migrate`、`npm run dev -- --hostname 127.0.0.1`，打开终端显示的本机地址。本地开发身份需要 `npm run db:seed`，该命令也写入示例课程，切勿在部署数据库运行。本地开发认证仅用于本机回环地址。创建私有 Site 前请阅读[部署和 MCP](docs/deployment.md)。

项目使用 React、TypeScript、Vinext、Drizzle、D1 和 R2，迁移位于 `drizzle/`。随附 Sites Vite 插件保留其[许可证](scripts/vite/sites-vite-plugin.LICENSE)。

许可证选择尚待作者确认；此候选目前尚未获公开再分发许可。

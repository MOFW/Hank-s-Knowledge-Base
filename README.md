# Hank’s Knowledge Base

[中文](README.zh-CN.md)

HKB is a personal, ChatGPT-oriented knowledge base for turning learning conversations into continuously readable textbook-like notes, examples and interactive solutions. Read like a textbook, explore explanations like a student with a teacher, and accumulate knowledge like a notebook.

Courses offer continuous reading and a complete directory. Notes can embed selected problems; solutions support mathematical derivations, independent alternative methods, and expandable follow-up explanations. ChatGPT can organize, edit and delete material through MCP, with single-round undo. Markdown, LaTeX, code, attachments and private learning records are supported.

Try natural requests such as “Organize what we just discussed into my knowledge base”, “Add this follow-up to the earlier problem”, “Save this solution too”, or “Undo the last change”.

HKB targets ChatGPT, Codex and ChatGPT Sites, for personal use. Availability depends on account and platform permissions. Other AI clients and hosting environments are not currently supported commitments. DeepSeek review is optional.

## Getting started

Requires Node.js 22.13 or later and npm. For local development, run `npm run install:ci`, `npm run db:migrate`, and `npm run dev -- --hostname 127.0.0.1`. Open the displayed loopback address. The local developer identity requires `npm run db:seed`, which also adds sample course material; do not run it on a deployed database. Local development authentication is for loopback only. See [deployment and MCP](docs/deployment.md) before creating a private Site.

The application uses React, TypeScript, Vinext, Drizzle, D1 and R2. Migrations are in `drizzle/`. The bundled Sites Vite plugin retains its own [license](scripts/vite/sites-vite-plugin.LICENSE).

HKB is licensed under the [MIT License](LICENSE). Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

The independent snapshot was verified locally for installation, build, empty D1 migrations, startup and basic MCP operations. A separate private Site deployed and owner sign-in succeeded; hosted MCP read/write and access rejection for another user have not been verified. See [deployment](docs/deployment.md).

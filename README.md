# T3 App Template

基于 [T3 Stack](https://create.t3.gg/) 的全栈项目模板。

## 技术栈

- [Next.js](https://nextjs.org) — React 全栈框架 (App Router)
- [tRPC](https://trpc.io) — 端到端类型安全的 API 层
- [Drizzle ORM](https://orm.drizzle.team) — TypeScript ORM
- [PostgreSQL](https://www.postgresql.org/) — 关系型数据库
- [Better Auth](https://www.better-auth.com/) — 认证方案（邮箱密码）
- [UnoCSS](https://unocss.dev/) — 原子化 CSS 引擎
- [Zod](https://zod.dev/) — 运行时类型校验

## 工程化

- [Biome](https://biomejs.dev/) — 代码格式化与 lint
- [Vitest](https://vitest.dev/) — 单元测试
- [Playwright](https://playwright.dev/) — E2E 测试
- [Husky](https://typicode.github.io/husky/) — Git hooks (pre-commit / commit-msg / pre-push)
- [Commitlint](https://commitlint.js.org/) — 提交信息规范 (`type: subject`)
- [cspell](https://cspell.org/) — 拼写检查

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动数据库 (Docker)
./start-database.sh

# 复制环境变量并填入配置
cp .env.example .env

# 推送数据库 schema
pnpm db:push

# 启动开发服务器
pnpm dev
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 (Turbopack) |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动生产服务器 |
| `pnpm check` | Biome lint 检查 |
| `pnpm check:write` | Biome 自动修复 |
| `pnpm type-check` | TypeScript 类型检查 |
| `pnpm test` | 运行单元测试 |
| `pnpm test:watch` | 监听模式运行测试 |
| `pnpm test:coverage` | 运行测试并生成覆盖率报告 |
| `pnpm test:e2e` | 运行 E2E 测试 |
| `pnpm db:generate` | 生成数据库迁移文件 |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm db:push` | 推送 schema 到数据库 |
| `pnpm db:studio` | 打开 Drizzle Studio |

## 部署

参考 T3 Stack 部署指南：[Vercel](https://create.t3.gg/en/deployment/vercel) | [Docker](https://create.t3.gg/en/deployment/docker)

项目已包含 `Dockerfile` 和 `docker-compose.yml`，可直接用于容器化部署。

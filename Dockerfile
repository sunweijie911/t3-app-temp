##### BASE
FROM node:22-alpine AS base
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

##### DEPENDENCIES
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com && \
    pnpm install --frozen-lockfile

##### BUILDER
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* 必须在 build 阶段注入：Next.js 会把客户端段的 NEXT_PUBLIC_* 静态内联进
# 客户端 bundle 与静态产物，运行时(.env/env_file)无法再覆盖。由 CI 通过 --build-arg 传入，
# 未传入时为空串 —— build 阶段设了 SKIP_ENV_VALIDATION（不应用 zod 默认值），
# 由各消费点的下游兜底回退到合理默认（parseAuthMethod→email-otp、SITE_NAME `|| 模块名`、
# DEFAULT_MODULE `?? lucky-wheel` 等）。
# 注意：app(runner) 与 nginx 两个目标都派生自本 builder，必须传入相同 build-arg，
# 否则 nginx 提供的静态 JS 与 app 服务端读取的值会不一致。
ARG NEXT_PUBLIC_SITE_NAME=""
ARG NEXT_PUBLIC_MODULE_NAMES=""
ARG NEXT_PUBLIC_DEFAULT_MODULE=""
ARG NEXT_PUBLIC_ENABLED_MODULES=""
ARG NEXT_PUBLIC_AUTH_METHOD=""
ARG NEXT_PUBLIC_DINGTALK_CORP_ID=""
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_MODULE_NAMES=$NEXT_PUBLIC_MODULE_NAMES
ENV NEXT_PUBLIC_DEFAULT_MODULE=$NEXT_PUBLIC_DEFAULT_MODULE
ENV NEXT_PUBLIC_ENABLED_MODULES=$NEXT_PUBLIC_ENABLED_MODULES
ENV NEXT_PUBLIC_AUTH_METHOD=$NEXT_PUBLIC_AUTH_METHOD
ENV NEXT_PUBLIC_DINGTALK_CORP_ID=$NEXT_PUBLIC_DINGTALK_CORP_ID

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# Compile seed scripts for production (no tsx in runner)
RUN pnpm exec esbuild scripts/seed-test-data.ts \
    --bundle --platform=node --format=esm \
    --outfile=seed.mjs \
    --external:postgres \
    --tsconfig=tsconfig.json

RUN pnpm exec esbuild scripts/seed-admin.ts \
    --bundle --platform=node --format=esm \
    --outfile=seed-admin.mjs \
    --external:postgres \
    --tsconfig=tsconfig.json

RUN pnpm exec esbuild scripts/seed-im-bot-sales.ts \
    --bundle --platform=node --format=esm \
    --outfile=seed-im-bot-sales.mjs \
    --external:postgres \
    --tsconfig=tsconfig.json

RUN pnpm exec esbuild scripts/seed-im-bot-devops.ts \
    --bundle --platform=node --format=esm \
    --outfile=seed-im-bot-devops.mjs \
    --external:postgres \
    --tsconfig=tsconfig.json

##### NGINX - serve 静态文件 + 反代 Next.js
FROM nginx:alpine AS nginx

# 构建产物 _next/static
COPY --from=builder /app/.next/static /usr/share/nginx/static

# public 目录静态资源（favicon.ico、lucky-wheel/ 等，排除 uploads）
COPY --from=builder /app/public /usr/share/nginx/public
RUN rm -rf /usr/share/nginx/public/uploads

# uploads 目录由卷挂载，预创建空目录
RUN mkdir -p /usr/share/nginx/uploads

##### RUNNER（默认构建目标）
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 预创建 uploads 目录，确保 volume 挂载后权限正确
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/seed.mjs ./seed.mjs
COPY --from=builder --chown=nextjs:nodejs /app/seed-admin.mjs ./seed-admin.mjs
COPY --from=builder --chown=nextjs:nodejs /app/seed-im-bot-sales.mjs ./seed-im-bot-sales.mjs
COPY --from=builder --chown=nextjs:nodejs /app/seed-im-bot-devops.mjs ./seed-im-bot-devops.mjs

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "node migrate.mjs && if [ \"$RUN_SEEDS\" = 'true' ]; then node seed.mjs; fi && if [ -n \"$SEED_ADMIN_EMAIL\" ]; then node seed-admin.mjs; fi && if [ \"$SEED_IM_BOT_SALES\" = 'true' ]; then node seed-im-bot-sales.mjs; fi && if [ \"$SEED_IM_BOT_DEVOPS\" = 'true' ]; then node seed-im-bot-devops.mjs; fi && node server.js"]

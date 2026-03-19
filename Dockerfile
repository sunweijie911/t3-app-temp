##### BASE
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.5 --activate

##### DEPENDENCIES
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

##### BUILDER
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# Compile seed script for production (no tsx in runner)
RUN pnpm exec esbuild scripts/seed-test-data.ts \
    --bundle --platform=node --format=esm \
    --outfile=seed.mjs \
    --external:postgres \
    --tsconfig=tsconfig.json

##### RUNNER
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 预创建 uploads 目录，确保 volume 挂载后权限正确
RUN mkdir -p ./public/uploads/info-collect && chown -R nextjs:nodejs ./public/uploads
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /app/seed.mjs ./seed.mjs

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "-c", "node migrate.mjs && if [ \"$RUN_SEEDS\" = 'true' ]; then node seed.mjs; fi && node server.js"]

##### NGINX - serve 静态文件 + 反代 Next.js
FROM nginx:alpine AS nginx

# 构建产物 _next/static
COPY --from=builder /app/.next/static /usr/share/nginx/static

# public 目录静态资源（favicon.ico、lucky-wheel/ 等，排除 uploads）
COPY --from=builder /app/public /usr/share/nginx/public
RUN rm -rf /usr/share/nginx/public/uploads

# uploads 目录由卷挂载，预创建空目录
RUN mkdir -p /usr/share/nginx/uploads

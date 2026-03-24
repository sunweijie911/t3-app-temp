/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { ZodError } from 'zod';

import { auth } from '@/server/better-auth';
import { getUserPhone } from '@/server/better-auth/types';
import { db } from '@/server/db';
import { adminAuditLog } from '@/server/db/schema';
import { isAdminEmail, isAdminPhone } from '@/server/services/admin-check';

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const session = await auth.api.getSession({
    headers: opts.headers,
  });
  return {
    db,
    session,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // 开发环境模拟网络延迟
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  if (t._config.isDev) {
    const end = Date.now();
    console.log(`[TRPC] ${path} took ${end - start}ms to execute`);
  }

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the session is valid and guarantees `ctx.session.user` is not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.session?.user) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({
      ctx: {
        // 将 session 类型收窄为非空
        session: { ...ctx.session, user: ctx.session.user },
      },
    });
  });

/**
 * 对输入参数进行脱敏，移除密码、token 等敏感字段。
 */
function sanitizeInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const sensitiveKeys = ['password', 'secret', 'token', 'otp', 'code'];
  const sanitized = { ...(input as Record<string, unknown>) };
  for (const key of sensitiveKeys) {
    if (key in sanitized) sanitized[key] = '***';
  }
  return sanitized;
}

/**
 * 审计日志中间件 —— 记录所有 admin mutation 操作到 adminAuditLog 表。
 * 异步写入，不阻塞响应。
 */
const auditMiddleware = t.middleware(
  async ({ ctx, next, path, type, getRawInput }) => {
    if (type !== 'mutation') return next({ ctx });
    if (!ctx.session?.user) return next({ ctx });

    const sessionUser = ctx.session.user;
    const rawInput = await getRawInput();
    const ip =
      ctx.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const ua = ctx.headers.get('user-agent') ?? null;

    const writeLog = (values: typeof adminAuditLog.$inferInsert) => {
      db.insert(adminAuditLog)
        .values(values)
        .catch((err) => console.error('[AuditLog] 写入失败:', err));
    };

    try {
      const result = await next({ ctx });
      writeLog({
        userId: sessionUser.id,
        userEmail: sessionUser.email,
        action: path,
        input: sanitizeInput(rawInput) as Record<string, unknown>,
        result: 'success',
        ipAddress: ip,
        userAgent: ua,
      });
      return result;
    } catch (error) {
      writeLog({
        userId: sessionUser.id,
        userEmail: sessionUser.email,
        action: path,
        input: sanitizeInput(rawInput) as Record<string, unknown>,
        result: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: ip,
        userAgent: ua,
      });
      throw error;
    }
  },
);

/**
 * 管理员专用过程 —— 邮箱在 ADMIN_EMAILS 或手机号在 ADMIN_PHONES 白名单中即可访问。
 * 继承自 protectedProcedure，确保登录态校验保持一致。
 * 所有 mutation 操作自动记录审计日志。
 */
export const adminProcedure = protectedProcedure
  .use(({ ctx, next }) => {
    const phone = getUserPhone(ctx.session.user);
    if (!isAdminEmail(ctx.session.user.email) && !isAdminPhone(phone)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return next({ ctx });
  })
  .use(auditMiddleware);

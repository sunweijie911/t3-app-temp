import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/server/better-auth';
import { getUserPhone } from '@/server/better-auth/types';
import { isAdminEmail, isAdminPhone } from '@/server/services/admin-check';
import { authIpLimiter, globalIpLimiter } from '@/server/services/rate-limiter';

// Required for auth.api.getSession() which uses the postgres driver (Node.js only)
export const runtime = 'nodejs';

const protectedPatterns = [
  /^\/admin(\/|$)/,
  /^\/soulscope\/results(\/|$)/,
  /^\/soulscope\/tests\/[^/]+\/take(\/|$)/,
  /^\/lucky-wheel\/records(\/|$)/,
];

function getClientIp(request: NextRequest): string {
  // 优先使用 X-Real-IP（nginx 从 $remote_addr 设置，不可伪造）
  // X-Forwarded-For 使用追加模式，首跳可被客户端伪造
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function rateLimitResponse(retryAfterMs: number, message: string) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);

  // ── IP 限流（在所有逻辑之前） ──

  // 对 API 路由执行全局 IP 限流
  if (pathname.startsWith('/api/')) {
    const globalCheck = globalIpLimiter.check(ip);
    if (!globalCheck.allowed) {
      return rateLimitResponse(
        globalCheck.retryAfterMs,
        '请求过于频繁，请稍后再试',
      );
    }
  }

  // 登录接口额外严格限流（覆盖密码登录 + 手机号 OTP）
  if (
    pathname.startsWith('/api/auth/sign-in') ||
    pathname.startsWith('/api/auth/phone-number/') ||
    pathname.startsWith('/api/auth/email-otp/')
  ) {
    const authCheck = authIpLimiter.check(ip);
    if (!authCheck.allowed) {
      return rateLimitResponse(
        authCheck.retryAfterMs,
        '登录尝试过于频繁，请稍后再试',
      );
    }
  }

  // ── 页面认证保护 ──

  const isProtected = protectedPatterns.some((p) => p.test(pathname));
  if (!isProtected) return NextResponse.next();

  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    const signinUrl = new URL('/signin', request.url);
    signinUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signinUrl);
  }

  // /admin 路由需要管理员权限（邮箱或手机号任一匹配即可）
  if (pathname.startsWith('/admin')) {
    const phone = getUserPhone(session.user);
    if (!isAdminEmail(session.user.email) && !isAdminPhone(phone)) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/auth/:path*',
    '/api/trpc/:path*',
    '/api/upload',
    '/admin/:path*',
    '/soulscope/results/:path*',
    '/soulscope/tests/:slug/take/:path*',
    '/lucky-wheel/records/:path*',
  ],
};

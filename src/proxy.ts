import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/server/better-auth';
import { getUserPhone } from '@/server/better-auth/types';
import { isAdminEmail, isAdminPhone } from '@/server/services/admin-check';
import { getClientIp } from '@/server/services/get-client-ip';
import {
  authIpLimiter,
  globalIpLimiter,
  otpSendLimiter,
} from '@/server/services/rate-limiter';

const protectedPatterns = [
  /^\/admin(\/|$)/,
  /^\/soulscope\/results(\/|$)/,
  /^\/soulscope\/tests\/[^/]+\/take(\/|$)/,
  /^\/lucky-wheel\/records(\/|$)/,
];

function rateLimitResponse(retryAfterMs: number, message: string) {
  // 同时返回 message（better-auth 客户端读取此字段）、code 与 error（上传等接口读取 error），
  // 确保限流提示能被前端正确解析展示，而非回退成误导性的「验证码错误」。
  return NextResponse.json(
    { error: message, message, code: 'RATE_LIMITED' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}

// 有成本的验证码发送端点（短信/邮件），单独严格限流
const OTP_SEND_PATHS = new Set([
  '/api/auth/email-otp/send-verification-otp',
  '/api/auth/phone-number/send-otp',
]);

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

  // 验证码发送端点：严格限流（有短信/邮件成本）
  if (OTP_SEND_PATHS.has(pathname)) {
    const sendCheck = otpSendLimiter.check(ip);
    if (!sendCheck.allowed) {
      return rateLimitResponse(
        sendCheck.retryAfterMs,
        '验证码发送过于频繁，请稍后再试',
      );
    }
  }

  // 登录 / 验证端点：宽松限流（防暴力，但不误伤正常登录）。
  // 不含发送端点；验证另有 better-auth allowedAttempts 兜底，故阈值可宽松。
  if (
    pathname.startsWith('/api/auth/sign-in') ||
    pathname === '/api/auth/phone-number/verify' ||
    pathname === '/api/auth/dingtalk/sign-in'
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

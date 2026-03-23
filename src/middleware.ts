import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/server/better-auth';
import { getUserPhone } from '@/server/better-auth/types';
import { isAdminEmail, isAdminPhone } from '@/server/services/admin-check';

// Required for auth.api.getSession() which uses the postgres driver (Node.js only)
export const runtime = 'nodejs';

const protectedPatterns = [
  /^\/admin(\/|$)/,
  /^\/soulscope\/results(\/|$)/,
  /^\/soulscope\/tests\/[^/]+\/take(\/|$)/,
  /^\/lucky-wheel\/records(\/|$)/,
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
    '/admin/:path*',
    '/soulscope/results/:path*',
    '/soulscope/tests/:slug/take/:path*',
    '/lucky-wheel/records/:path*',
  ],
};

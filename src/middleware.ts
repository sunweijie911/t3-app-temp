import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/server/better-auth';

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

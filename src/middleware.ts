import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const protectedPatterns = [
  /^\/admin(\/|$)/,
  /^\/results(\/|$)/,
  /^\/tests\/[^/]+\/take(\/|$)/,
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedPatterns.some((p) => p.test(pathname));
  if (!isProtected) return NextResponse.next();

  // Better Auth default cookie name
  const sessionCookie =
    request.cookies.get('better-auth.session_token') ??
    request.cookies.get('__Secure-better-auth.session_token');

  if (!sessionCookie) {
    const signinUrl = new URL('/signin', request.url);
    signinUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signinUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/results/:path*', '/tests/:slug/take/:path*'],
};

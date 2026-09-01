import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE = 'discador_auth';
const LOGIN_PATH = '/login';
const API_LOGIN_PATH = '/api/auth/login';
const STATIC_PATHS = ['/favicon.ico', '/robots.txt', '/_next', '/api/auth'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Skip static files and API auth routes
  if (STATIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  
  // Check if user is authenticated
  const authCookie = request.cookies.get(AUTH_COOKIE);
  const isAuthenticated = authCookie?.value === process.env.AUTH_SECRET;
  
  // If not authenticated and not on login page, redirect to login
  if (!isAuthenticated && pathname !== LOGIN_PATH) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  // If authenticated and on login page, redirect to home
  if (isAuthenticated && pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

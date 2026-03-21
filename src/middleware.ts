import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Only log API routes, skip Next.js internals and public assets
  if (request.nextUrl.pathname.startsWith('/api/')) {
    console.log(`[API] ${request.method} ${request.nextUrl.pathname}`);
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};

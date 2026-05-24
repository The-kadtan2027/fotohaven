import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only log and potentially protect API routes
  if (pathname.startsWith('/api/')) {
    console.log(`[API] ${request.method} ${pathname}`);

    // Admin routes that require APP_SECRET
    const isAdminRoute = 
      pathname.startsWith('/api/albums') || 
      pathname.startsWith('/api/photos') || 
      pathname.startsWith('/api/ceremonies') ||
      pathname.startsWith('/api/admin');

    if (isAdminRoute) {
      const authHeader = request.headers.get('Authorization');
      const appSecret = process.env.APP_SECRET;

      // If APP_SECRET is set, enforce it
      if (appSecret && (!authHeader || authHeader !== `Bearer ${appSecret}`)) {
        return NextResponse.json(
          { error: 'Unauthorized: Admin access required' },
          { status: 401 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Routes that do NOT require authentication
const PUBLIC_API_PREFIXES = [
  '/api/auth/',
  '/api/share/',
  '/api/comments/',
  '/api/files/',
];

// API routes that require authentication
const GUARDED_API_PREFIXES = [
  '/api/albums',
  '/api/upload',
  '/api/photos',
  '/api/ceremonies',
];

async function verifySession(request: NextRequest): Promise<boolean> {
  const sessionCookie = request.cookies.get('session');
  if (!sessionCookie?.value) return false;

  const secret = process.env.JWT_SECRET;
  if (!secret) return false;

  try {
    const encodedSecret = new TextEncoder().encode(secret);
    await jwtVerify(sessionCookie.value, encodedSecret);
    return true;
  } catch {
    return false;
  }
}

// Methods on /api/photos/* that don't require auth (called from share page)
const PUBLIC_PHOTO_METHODS = new Set(['PATCH', 'GET']);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Log all API requests
  if (pathname.startsWith('/api/')) {
    console.log(`[API] ${request.method} ${pathname}`);
  }

  // Skip auth check for public API routes
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return NextResponse.next();
    }
  }

  // Guard API routes — return 401 JSON for unauthenticated requests
  for (const prefix of GUARDED_API_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      // /api/photos PATCH and GET are public (client selection from share page)
      if (prefix === '/api/photos' && PUBLIC_PHOTO_METHODS.has(request.method)) {
        return NextResponse.next();
      }
      const isValid = await verifySession(request);
      if (!isValid) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      return NextResponse.next();
    }
  }

  // Guard browser admin routes: /, /albums, /albums/*
  // The matcher already limits which routes reach this middleware
  if (pathname === '/' || pathname.startsWith('/albums')) {
    const isValid = await verifySession(request);
    if (!isValid) {
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // API routes
    '/api/:path*',
    // Admin browser routes (exact root + albums)
    '/',
    '/albums/:path*',
  ],
};


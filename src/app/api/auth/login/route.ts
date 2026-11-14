import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose/jwt/sign';
import { db } from '@/lib/db';
import { photographers } from '@/lib/schema';
import { logger } from '@/lib/logger';
import { withHandler, apiSuccess, apiBadRequest, apiUnauthorized, apiError } from '@/lib/api-response';

export const POST = withHandler('POST /api/auth/login', async (request: Request) => {
  const body = await request.json();
  const username = body.username?.trim();
  const password = body.password;

  if (!username || !password) {
    return apiBadRequest('Username and password are required');
  }

  // Look up photographer by username
  const photographer = db
    .select()
    .from(photographers)
    .where(eq(photographers.username, username))
    .get();

  if (!photographer) {
    logger.warn('AUTH', `Failed login attempt for unknown user: ${username}`);
    return apiUnauthorized('Invalid credentials');
  }

  // Verify password
  const valid = await bcrypt.compare(password, photographer.passwordHash);
  if (!valid) {
    logger.warn('AUTH', `Failed login attempt (invalid password) for user: ${username}`);
    return apiUnauthorized('Invalid credentials');
  }

  // Create JWT
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('AUTH', 'JWT_SECRET is not configured in process.env');
    return apiError('Server configuration error', { status: 500 });
  }

  const encodedSecret = new TextEncoder().encode(secret);
  const token = await new SignJWT({ sub: photographer.id, username: photographer.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(encodedSecret);

  logger.info('AUTH', `Successful login for user: ${username}`);

  const response = apiSuccess({ username: photographer.username });
  response.cookies.set('session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return response;
});

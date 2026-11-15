import { and, desc, eq, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { activityLogs, albums, guests, guestOtps } from "@/lib/schema";
import {
  getGuestCookieName,
  getGuestSessionMaxAgeSeconds,
  signGuestSession,
} from "@/lib/guest-auth";
import { logger } from "@/lib/logger";
import { withHandler, apiSuccess, apiBadRequest, apiUnauthorized, apiNotFound, apiError } from "@/lib/api-response";
import { clearRateLimit } from "@/lib/rate-limit";
import { hasUsableFaceDescriptor } from "@/lib/face-descriptor";
import { isSecureRequest } from "@/lib/request-protocol";
import {
  clientIp,
  consumeRateLimit,
  isRateLimited,
  OTP_VERIFY_IDENTITY,
  OTP_VERIFY_IP,
  otpIdentityKey,
  otpIpKey,
  tooManyRequests,
} from "@/lib/auth-limits";

type VerifyOtpBody = {
  token?: string;
  email?: string;
  name?: string;
  phone?: string;
  otp?: string;
  code?: string;
};

function isOtpBypassEnabled() {
  return process.env.GUEST_OTP_BYPASS === "true";
}

function buildOtpHash(code: string, albumId: string, email: string) {
  const secret = process.env.APP_SECRET || process.env.JWT_SECRET || "fotohaven-guest-otp";
  return createHash("sha256")
    .update(`${code}:${albumId}:${email.toLowerCase().trim()}:${secret}`)
    .digest("hex");
}

export const POST = withHandler("POST /api/guest/verify-otp", async (request: Request) => {
  const body = (await request.json()) as VerifyOtpBody;
  const token = body.token?.trim();
  const email = body.email?.trim().toLowerCase();
  const otp = (body.otp || body.code)?.trim();
  let name = body.name?.trim();
  const phone = body.phone?.trim() || null;
  const bypass = isOtpBypassEnabled();

  if (!token || !email || (!bypass && !otp)) {
    return apiBadRequest("token, email, and passcode are required");
  }

  const album = db
    .select({ id: albums.id, expiresAt: albums.expiresAt })
    .from(albums)
    .where(eq(albums.shareToken, token))
    .get();

  if (!album) {
    return apiNotFound("Album not found");
  }

  if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
    return apiError("This link has expired", { status: 410, code: "LINK_EXPIRED" });
  }

  const ip = clientIp(request);
  const identityKey = otpIdentityKey(email, album.id);
  const ipKey = otpIpKey(ip);
  const identityLimit = isRateLimited(identityKey, OTP_VERIFY_IDENTITY);
  const ipLimit = isRateLimited(ipKey, OTP_VERIFY_IP);

  if (!bypass && (!identityLimit.allowed || !ipLimit.allowed)) {
    return tooManyRequests(
      !identityLimit.allowed ? identityLimit : ipLimit,
      "Too many incorrect passcodes. Please try again later."
    );
  }

  const recordFailedAttempt = () => {
    if (bypass) return;
    consumeRateLimit(identityKey, OTP_VERIFY_IDENTITY);
    consumeRateLimit(ipKey, OTP_VERIFY_IP);
  };

  if (!bypass) {
    const otpRow = db
      .select()
      .from(guestOtps)
      .where(
        and(
          eq(guestOtps.albumId, album.id),
          eq(guestOtps.email, email),
          isNull(guestOtps.consumedAt)
        )
      )
      .orderBy(desc(guestOtps.createdAt))
      .get();

    if (!otpRow) {
      logger.warn("AUTH", `OTP verification failed (no active OTP) for ${email}`);
      recordFailedAttempt();
      return apiUnauthorized("Invalid passcode");
    }

    const now = new Date();
    if (new Date(otpRow.expiresAt) < now) {
      logger.warn("AUTH", `OTP verification failed (expired) for ${email}`);
      recordFailedAttempt();
      return apiUnauthorized("Passcode expired");
    }

    const expected = buildOtpHash(otp!, album.id, email);
    if (expected !== otpRow.codeHash) {
      logger.warn("AUTH", `OTP verification failed (code mismatch) for ${email}`);
      recordFailedAttempt();
      return apiUnauthorized("Invalid passcode");
    }

    db.update(guestOtps).set({ consumedAt: now }).where(eq(guestOtps.id, otpRow.id)).run();
    // A verified identity starts with a clean failure window.
    clearRateLimit(identityKey);
  } else {
    logger.warn("AUTH", `Bypass enabled. OTP validation skipped for ${email} (album=${album.id})`);
  }

  const existingGuest = db
    .select()
    .from(guests)
    .where(and(eq(guests.albumId, album.id), eq(guests.email, email)))
    .get();

  if (!name) {
    name = existingGuest?.name || email.split("@")[0];
  }

  const sessionToken = uuidv4();
  let guestId = existingGuest?.id;

  if (!guestId) {
    guestId = uuidv4();
    db.insert(guests)
      .values({
        id: guestId,
        albumId: album.id,
        name,
        email,
        phone,
        sessionToken,
        createdAt: new Date(),
      })
      .run();
  } else {
    db.update(guests)
      .set({
        name,
        phone: phone || existingGuest?.phone || null,
        sessionToken,
      })
      .where(eq(guests.id, guestId))
      .run();
  }

  const guestJwt = await signGuestSession({
    sub: guestId,
    albumId: album.id,
    email,
    st: sessionToken,
  });

  logger.info("AUTH", `Guest verified successfully: ${email} (guestId=${guestId})`);

  const response = apiSuccess({
    bypass,
    name,
    hasFaceDescriptor: hasUsableFaceDescriptor(existingGuest?.faceDescriptor),
  });

  response.cookies.set(getGuestCookieName(), guestJwt, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "lax",
    path: "/",
    maxAge: getGuestSessionMaxAgeSeconds(),
  });

  try {
    db.insert(activityLogs).values({
      id: uuidv4(),
      albumId: album.id,
      guestId,
      eventType: "guest_login",
      createdAt: new Date(),
    }).run();
  } catch (e) {
    logger.warn("DB", "Failed to log activity:", e);
  }

  return response;
});

import { and, desc, eq, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { albums, guestOtps } from "@/lib/schema";
import { sendGuestOtpEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { withHandler, apiSuccess, apiBadRequest, apiNotFound, apiError } from "@/lib/api-response";

type RequestOtpBody = {
  token?: string;
  name?: string;
  email?: string;
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

function createOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export const POST = withHandler("POST /api/guest/request-otp", async (request: Request) => {
  const body = (await request.json()) as RequestOtpBody;
  const token = body.token?.trim();
  const email = body.email?.trim().toLowerCase();
  const name = body.name?.trim();

  if (!token || !email || !name) {
    return apiBadRequest("token, name, and email are required");
  }

  const album = db
    .select({ id: albums.id, title: albums.title, expiresAt: albums.expiresAt })
    .from(albums)
    .where(eq(albums.shareToken, token))
    .get();

  if (!album) {
    return apiNotFound("Album not found");
  }

  if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
    return apiError("This link has expired", { status: 410, code: "LINK_EXPIRED" });
  }

  const existingActive = db
    .select({ id: guestOtps.id })
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

  if (existingActive) {
    db
      .update(guestOtps)
      .set({ consumedAt: new Date() })
      .where(eq(guestOtps.id, existingActive.id))
      .run();
  }

  const bypass = isOtpBypassEnabled();
  const otpCode = bypass ? "000000" : createOtpCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  db.insert(guestOtps)
    .values({
      id: uuidv4(),
      albumId: album.id,
      email,
      codeHash: buildOtpHash(otpCode, album.id, email),
      expiresAt,
      createdAt: now,
    })
    .run();

  if (!bypass) {
    await sendGuestOtpEmail(email, otpCode, album.title);
    logger.info("AUTH", `Guest OTP requested for ${email} (album=${album.id})`);
  } else {
    logger.warn("AUTH", `Bypass enabled. OTP email skipped for ${email} (album=${album.id})`);
  }

  return apiSuccess({
    bypass,
    ...(bypass ? { testOtp: otpCode } : {}),
  });
});

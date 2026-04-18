import { NextResponse } from "next/server";
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

type VerifyOtpBody = {
  token?: string;
  email?: string;
  name?: string;
  phone?: string;
  otp?: string;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VerifyOtpBody;
    const token = body.token?.trim();
    const email = body.email?.trim().toLowerCase();
    const otp = body.otp?.trim();
    const name = body.name?.trim();
    const phone = body.phone?.trim() || null;
    const bypass = isOtpBypassEnabled();

    if (!token || !email || !name || (!bypass && !otp)) {
      return NextResponse.json(
        { error: "token, email, otp, and name are required" },
        { status: 400 }
      );
    }

    const album = db
      .select({ id: albums.id, expiresAt: albums.expiresAt })
      .from(albums)
      .where(eq(albums.shareToken, token))
      .get();

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

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
        return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
      }

      const now = new Date();
      if (new Date(otpRow.expiresAt) < now) {
        return NextResponse.json({ error: "OTP expired" }, { status: 401 });
      }

      const expected = buildOtpHash(otp!, album.id, email);
      if (expected !== otpRow.codeHash) {
        return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
      }

      db.update(guestOtps).set({ consumedAt: now }).where(eq(guestOtps.id, otpRow.id)).run();
    } else {
      console.warn(
        `[GUEST OTP] Bypass enabled. OTP validation skipped for ${email} (album=${album.id}).`
      );
    }

    const existingGuest = db
      .select()
      .from(guests)
      .where(and(eq(guests.albumId, album.id), eq(guests.email, email)))
      .get();

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
          phone,
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

    const response = NextResponse.json({
      ok: true,
      bypass,
      name,
      hasFaceDescriptor: Boolean(existingGuest?.faceDescriptor),
    });
    response.cookies.set(getGuestCookieName(), guestJwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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
      console.warn("Failed to log activity:", e);
    }

    return response;
  } catch (error) {
    console.error("[POST /api/guest/verify-otp]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


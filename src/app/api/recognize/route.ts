import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, guests } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";
import { FACE_CONFIG } from "@/lib/face-config";

type RecognizeBody = {
  event_id?: string;
  image_b64?: string;
  high_threshold?: number;
  low_threshold?: number;
};

async function hasValidGuestSession(albumId: string) {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(getGuestCookieName())?.value;
    if (!session) {
      return false;
    }

    const payload = await verifyGuestSession(session);
    if (payload.albumId !== albumId) {
      return false;
    }

    const guest = db
      .select()
      .from(guests)
      .where(and(eq(guests.id, payload.sub), eq(guests.albumId, payload.albumId)))
      .get();

    return Boolean(guest?.sessionToken && guest.sessionToken === payload.st);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecognizeBody;
    if (!body.event_id || !body.image_b64) {
      return NextResponse.json(
        { error: "Missing event_id or image_b64" },
        { status: 400 }
      );
    }

    const album = db
      .select({ id: albums.id })
      .from(albums)
      .where(or(eq(albums.id, body.event_id), eq(albums.shareToken, body.event_id)))
      .get();

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const authed = await hasValidGuestSession(album.id);
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceUrl =
      FACE_CONFIG.remoteServiceUrl ||
      FACE_CONFIG.localNativeServiceUrl ||
      "http://127.0.0.1:5080";

    const payload = {
      ...body,
      event_id: album.id,
    };

    const response = await fetch(`${serviceUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
    });
  } catch (error) {
    console.error("[POST /api/recognize]", error);
    return NextResponse.json(
      { error: "Face service unavailable" },
      { status: 503 }
    );
  }
}

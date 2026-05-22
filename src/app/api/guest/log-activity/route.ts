import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { guests } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";
import { logActivity, type ActivityEventType } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

const VALID_EVENT_TYPES = new Set([
  "gallery_viewed",
  "photo_selected",
  "photo_deselected",
  "download_started",
  "face_scan_completed",
  "guest_login",
  "face_scan",
  "photo_download",
]);

type LogBody = {
  eventType?: string;
  payload?: unknown;
};

function normalizeEventType(eventType: string): ActivityEventType {
  if (eventType === "face_scan") return "face_scan_completed";
  if (eventType === "photo_download") return "download_started";
  return eventType as ActivityEventType;
}

async function getAuthenticatedGuest() {
  const cookieStore = await cookies();
  const session = cookieStore.get(getGuestCookieName())?.value;
  if (!session) return null;

  const payload = await verifyGuestSession(session);
  const guest = db
    .select()
    .from(guests)
    .where(and(eq(guests.id, payload.sub), eq(guests.albumId, payload.albumId)))
    .get();

  if (!guest || !guest.sessionToken || guest.sessionToken !== payload.st) {
    return null;
  }

  return guest;
}

export async function POST(request: Request) {
  try {
    const guest = await getAuthenticatedGuest();
    if (!guest) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as LogBody;
    const { eventType, payload } = body;

    if (!eventType || typeof eventType !== "string" || !VALID_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: "Invalid or missing eventType" }, { status: 400 });
    }

    logActivity({
      albumId: guest.albumId,
      guestId: guest.id,
      eventType: normalizeEventType(eventType),
      payload,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/guest/log-activity]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

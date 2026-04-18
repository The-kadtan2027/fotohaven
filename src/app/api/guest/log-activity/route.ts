import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { activityLogs, guests } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";

export const dynamic = "force-dynamic";

type LogBody = {
  eventType?: string;
  payload?: any;
};

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

    if (!eventType || typeof eventType !== "string") {
      return NextResponse.json({ error: "eventType is required" }, { status: 400 });
    }

    db.insert(activityLogs).values({
      id: uuidv4(),
      albumId: guest.albumId,
      guestId: guest.id,
      eventType,
      payload: payload ? JSON.stringify(payload) : null,
      createdAt: new Date(),
    }).run();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/guest/log-activity]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

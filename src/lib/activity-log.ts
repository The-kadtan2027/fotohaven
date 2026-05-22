import { v4 as uuidv4 } from "uuid";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityLogs, guests } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";

type RequestWithCookies = {
  cookies: {
    get(name: string): { value: string } | undefined;
  };
};

export type ActivityEventType =
  | "gallery_viewed"
  | "photo_selected"
  | "photo_deselected"
  | "download_started"
  | "face_scan_completed"
  | "guest_login";

export async function getOptionalGuestFromRequest(
  request: RequestWithCookies,
  albumId?: string
) {
  try {
    const session = request.cookies.get(getGuestCookieName())?.value;
    if (!session) return null;

    const payload = await verifyGuestSession(session);
    if (albumId && payload.albumId !== albumId) {
      return null;
    }

    const guest = db
      .select()
      .from(guests)
      .where(and(eq(guests.id, payload.sub), eq(guests.albumId, payload.albumId)))
      .get();

    if (!guest || !guest.sessionToken || guest.sessionToken !== payload.st) {
      return null;
    }

    return guest;
  } catch {
    return null;
  }
}

export function logActivity(input: {
  albumId: string;
  guestId?: string | null;
  eventType: ActivityEventType;
  payload?: unknown;
}) {
  db.insert(activityLogs)
    .values({
      id: uuidv4(),
      albumId: input.albumId,
      guestId: input.guestId ?? null,
      eventType: input.eventType,
      payload: input.payload === undefined ? null : JSON.stringify(input.payload),
      createdAt: new Date(),
    })
    .run();
}

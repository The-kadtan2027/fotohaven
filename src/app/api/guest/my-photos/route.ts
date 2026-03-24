import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ceremonies, guests, photoFaces, photos } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";
import { cosineDistance, parseDescriptor } from "@/lib/face-math";

const DISTANCE_THRESHOLD = 0.5;

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(getGuestCookieName())?.value;
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const payload = await verifyGuestSession(session);

    const guest = db
      .select()
      .from(guests)
      .where(and(eq(guests.id, payload.sub), eq(guests.albumId, payload.albumId)))
      .get();

    if (!guest || !guest.sessionToken || guest.sessionToken !== payload.st) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!guest.faceDescriptor) {
      return NextResponse.json({ photoIds: [] });
    }

    const guestDescriptor = parseDescriptor(guest.faceDescriptor);

    const albumCeremonies = db
      .select({ id: ceremonies.id })
      .from(ceremonies)
      .where(eq(ceremonies.albumId, guest.albumId))
      .all();

    if (!albumCeremonies.length) {
      return NextResponse.json({ photoIds: [] });
    }

    const ceremonyIds = albumCeremonies.map((row) => row.id);
    const albumPhotos = db
      .select({ id: photos.id })
      .from(photos)
      .where(and(inArray(photos.ceremonyId, ceremonyIds), eq(photos.isReturn, false)))
      .all();

    if (!albumPhotos.length) {
      return NextResponse.json({ photoIds: [] });
    }

    const photoIds = albumPhotos.map((row) => row.id);
    const faces = db
      .select()
      .from(photoFaces)
      .where(inArray(photoFaces.photoId, photoIds))
      .all();

    const matched = new Set<string>();
    for (const face of faces) {
      try {
        const distance = cosineDistance(guestDescriptor, parseDescriptor(face.descriptor));
        if (distance < DISTANCE_THRESHOLD) {
          matched.add(face.photoId);
        }
      } catch {
        // Skip malformed descriptors
      }
    }

    return NextResponse.json({ photoIds: Array.from(matched) });
  } catch (error) {
    console.error("[GET /api/guest/my-photos]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

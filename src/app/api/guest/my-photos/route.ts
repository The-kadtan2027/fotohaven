import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ceremonies, guests, photoFaces, photos } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";
import { euclideanDistance, parseDescriptor } from "@/lib/face-math";

export const dynamic = "force-dynamic";

// Tightened from 0.5 — reduces false positives in large crowds (e.g. Indian weddings).
// face-api.js same-person threshold is typically = 0.6; = 0.35 is a stricter crowded-album cutoff.
const DISTANCE_THRESHOLD = 0.5;

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(getGuestCookieName())?.value;
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const payload = await verifyGuestSession(session);

    const guest = db
      .select()
      .from(guests)
      .where(and(eq(guests.id, payload.sub), eq(guests.albumId, payload.albumId)))
      .get();

    if (!guest || !guest.sessionToken || guest.sessionToken !== payload.st) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    if (!guest.faceDescriptor) {
      return NextResponse.json({ photos: [], guest: { name: guest.name } }, { headers: { "Cache-Control": "no-store" } });
    }

    const guestDescriptor = parseDescriptor(guest.faceDescriptor);

    // Single join query: photoFaces → photos → ceremonies filtered by albumId.
    // Replaces the previous 3-query chain and avoids loading all photo IDs into memory.
    const faces = db
      .select({
        id: photoFaces.id,
        photoId: photoFaces.photoId,
        descriptor: photoFaces.descriptor,
      })
      .from(photoFaces)
      .innerJoin(photos, eq(photoFaces.photoId, photos.id))
      .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
      .where(
        and(
          eq(ceremonies.albumId, guest.albumId),
          eq(photos.isReturn, false)
        )
      )
      .all();

    if (!faces.length) {
      return NextResponse.json({ photos: [], guest: { name: guest.name } }, { headers: { "Cache-Control": "no-store" } });
    }

    // Track best (lowest) distance per photo — a photo with multiple faces
    // is matched if ANY face is close enough, and we keep the strongest signal.
    const bestDistanceByPhoto = new Map<string, number>();
    for (const face of faces) {
      try {
        const distance = euclideanDistance(
          guestDescriptor,
          parseDescriptor(face.descriptor)
        );
        if (distance < DISTANCE_THRESHOLD) {
          const current = bestDistanceByPhoto.get(face.photoId);
          if (current === undefined || distance < current) {
            bestDistanceByPhoto.set(face.photoId, distance);
          }
        }
      } catch {
        // Skip malformed descriptors silently
      }
    }

    // Sort ascending by distance — strongest matches (score closest to 0) come first.
    const matched = Array.from(bestDistanceByPhoto.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([photoId, score]) => ({
        photoId,
        score: Math.round(score * 1000) / 1000,
      }));

    return NextResponse.json({ photos: matched, guest: { name: guest.name } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/guest/my-photos]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}






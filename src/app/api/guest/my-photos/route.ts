import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ceremonies, guests, photoFaces, photos } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";
import { FACE_CONFIG } from "@/lib/face-config";
import {
  averageDescriptors,
  euclideanDistance,
  parseDescriptor,
} from "@/lib/face-math";

export const dynamic = "force-dynamic";

type DiscoverySource = "selfie" | "refined";

type RefineBody = {
  photoIds?: string[];
};

type AlbumFace = {
  id: string;
  photoId: string;
  descriptor: string;
};

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

async function getAuthenticatedGuest() {
  const cookieStore = await cookies();
  const session = cookieStore.get(getGuestCookieName())?.value;
  if (!session) {
    return null;
  }

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

function getAlbumFaces(albumId: string) {
  return db
    .select({
      id: photoFaces.id,
      photoId: photoFaces.photoId,
      descriptor: photoFaces.descriptor,
    })
    .from(photoFaces)
    .innerJoin(photos, eq(photoFaces.photoId, photos.id))
    .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
    .where(and(eq(ceremonies.albumId, albumId), eq(photos.isReturn, false)))
    .all();
}

function scoreMatches(
  referenceDescriptor: Float32Array,
  faces: AlbumFace[],
  threshold: number
) {
  const bestDistanceByPhoto = new Map<string, number>();
  const faceCountByPhoto = new Map<string, number>();

  for (const face of faces) {
    faceCountByPhoto.set(face.photoId, (faceCountByPhoto.get(face.photoId) || 0) + 1);
    
    try {
      const distance = euclideanDistance(
        referenceDescriptor,
        parseDescriptor(face.descriptor)
      );
      if (distance <= threshold) {
        const current = bestDistanceByPhoto.get(face.photoId);
        if (current === undefined || distance < current) {
          bestDistanceByPhoto.set(face.photoId, distance);
        }
      }
    } catch {
      // Skip malformed descriptors silently.
    }
  }

  return Array.from(bestDistanceByPhoto.entries())
    .sort((a, b) => a[1] - b[1])
    .slice(0, FACE_CONFIG.maxResults)
    .map(([photoId, score]) => ({
      photoId,
      score: Math.round(score * 1000) / 1000,
      faceCount: faceCountByPhoto.get(photoId) || 1,
    }));
}

function buildRefinedDescriptor(
  guestDescriptor: Float32Array,
  confirmedPhotoIds: string[],
  faces: AlbumFace[]
) {
  const uniquePhotoIds = Array.from(new Set(confirmedPhotoIds));
  if (uniquePhotoIds.length < 1 || uniquePhotoIds.length > 3) {
    throw new Error("Please confirm between 1 and 3 photos.");
  }

  const anchors: Float32Array[] = [];
  for (const photoId of uniquePhotoIds) {
    const candidateFaces = faces.filter((face) => face.photoId === photoId);
    let bestDescriptor: Float32Array | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const face of candidateFaces) {
      try {
        const parsed = parseDescriptor(face.descriptor);
        const distance = euclideanDistance(guestDescriptor, parsed);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestDescriptor = parsed;
        }
      } catch {
        // Ignore malformed descriptors and continue.
      }
    }

    if (bestDescriptor) {
      anchors.push(bestDescriptor);
    }
  }

  if (!anchors.length) {
    throw new Error("Could not find usable face anchors in the confirmed photos.");
  }

  return averageDescriptors(anchors);
}

async function runDiscovery(source: DiscoverySource, confirmedPhotoIds?: string[]) {
  const guest = await getAuthenticatedGuest();
  if (!guest) {
    return noStoreJson({ error: "Not authenticated" }, { status: 401 });
  }

  if (!guest.faceDescriptor) {
    return noStoreJson({ photos: [], guest: { name: guest.name }, source });
  }

  const guestDescriptor = parseDescriptor(guest.faceDescriptor);
  const faces = getAlbumFaces(guest.albumId);

  if (!faces.length) {
    return noStoreJson({ photos: [], guest: { name: guest.name }, source });
  }

  const referenceDescriptor =
    source === "refined" && confirmedPhotoIds?.length
      ? buildRefinedDescriptor(guestDescriptor, confirmedPhotoIds, faces)
      : guestDescriptor;

  const threshold =
    source === "refined"
      ? FACE_CONFIG.possibleMatchThreshold
      : FACE_CONFIG.matchThreshold;

  const matched = scoreMatches(referenceDescriptor, faces, threshold);

  return noStoreJson({
    photos: matched,
    guest: { name: guest.name },
    source,
  });
}

export async function GET() {
  try {
    return await runDiscovery("selfie");
  } catch (error) {
    console.error("[GET /api/guest/my-photos]", error);
    return noStoreJson({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefineBody;
    if (
      !Array.isArray(body.photoIds) ||
      !body.photoIds.every((value) => typeof value === "string")
    ) {
      return noStoreJson(
        { error: "photoIds must be an array of photo IDs" },
        { status: 400 }
      );
    }

    return await runDiscovery("refined", body.photoIds);
  } catch (error) {
    if (error instanceof Error && error.message) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    console.error("[POST /api/guest/my-photos]", error);
    return noStoreJson({ error: "Internal server error" }, { status: 500 });
  }
}

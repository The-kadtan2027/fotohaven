import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums, ceremonies, guests, photoFaces, photos } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";
import { getPresignedUrl } from "@/lib/storage";
import { FACE_CONFIG } from "@/lib/face-config";
import {
  averageDescriptors,
  cosineSimilarity,
  parseDescriptor,
  vectorizedEuclideanDistances,
} from "@/lib/face-math";
import { getAlbumVectorMatrix, AlbumVectorMatrix } from "@/lib/vector-cache";

export const dynamic = "force-dynamic";

type DiscoverySource = "selfie" | "refined";

type RefineBody = {
  photoIds?: string[];
};

type AlbumFace = {
  id: string;
  photoId: string;
  descriptor: string;
  storageKey: string;
  thumbnailKey: string | null;
  originalName: string;
};

type MatchThresholds = {
  strong: number;
  possible: number;
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
      storageKey: photos.storageKey,
      thumbnailKey: photos.thumbnailKey,
      originalName: photos.originalName,
    })
    .from(photoFaces)
    .innerJoin(photos, eq(photoFaces.photoId, photos.id))
    .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
    .where(and(eq(ceremonies.albumId, albumId), eq(photos.isReturn, false)))
    .all();
}

function getAlbumThresholds(albumId: string): MatchThresholds {
  const album = db
    .select({
      highThreshold: albums.highThreshold,
      lowThreshold: albums.lowThreshold,
    })
    .from(albums)
    .where(eq(albums.id, albumId))
    .get();

  return {
    strong: album?.highThreshold ?? FACE_CONFIG.strongMatchThreshold,
    possible: album?.lowThreshold ?? FACE_CONFIG.possibleMatchThreshold,
  };
}

function scoreMatchesVectorized(
  referenceDescriptor: Float32Array,
  vectorData: AlbumVectorMatrix,
  thresholds: MatchThresholds
) {
  const photoDetails = new Map<string, { storageKey: string; thumbnailKey: string | null; originalName: string }>();
  const bestSimilarityByPhoto = new Map<string, number>();
  const faceCountByPhoto = new Map<string, number>();

  const { matrix, norms, faces, count } = vectorData;
  if (count === 0) return [];

  // Compute all N Euclidean distances simultaneously using vectorized SIMD dot products
  const distances = vectorizedEuclideanDistances(matrix, norms, referenceDescriptor, count, vectorData.vectorDim);

  for (let i = 0; i < count; i++) {
    const face = faces[i];
    if (!photoDetails.has(face.photoId)) {
      photoDetails.set(face.photoId, {
        storageKey: face.storageKey,
        thumbnailKey: face.thumbnailKey,
        originalName: face.originalName,
      });
    }
    faceCountByPhoto.set(face.photoId, (faceCountByPhoto.get(face.photoId) || 0) + 1);

    const distance = distances[i];
    if (distance <= thresholds.possible) {
      const similarity = Math.max(0, Math.min(1, 1 - distance));
      const current = bestSimilarityByPhoto.get(face.photoId);
      if (current === undefined || similarity > current) {
        bestSimilarityByPhoto.set(face.photoId, similarity);
      }
    }
  }

  return Array.from(bestSimilarityByPhoto.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, FACE_CONFIG.maxResults)
    .map(async ([photoId, score]) => {
      const details = photoDetails.get(photoId)!;
      return {
        photoId,
        score: Math.round(score * 1000) / 1000,
        faceCount: faceCountByPhoto.get(photoId) || 1,
        id: photoId,
        originalName: details.originalName,
        url: await getPresignedUrl(details.thumbnailKey || details.storageKey),
        originalUrl: await getPresignedUrl(details.storageKey),
      };
    });
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
    let bestSimilarity = Number.NEGATIVE_INFINITY;

    for (const face of candidateFaces) {
      try {
        const parsed = parseDescriptor(face.descriptor);
        const similarity = cosineSimilarity(guestDescriptor, parsed);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
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
  const vectorData = getAlbumVectorMatrix(guest.albumId);

  if (vectorData.count === 0) {
    return noStoreJson({ photos: [], guest: { name: guest.name }, source });
  }

  const thresholds = getAlbumThresholds(guest.albumId);
  
  let referenceDescriptor = guestDescriptor;
  if (source === "refined" && confirmedPhotoIds?.length) {
    const faces = getAlbumFaces(guest.albumId);
    referenceDescriptor = buildRefinedDescriptor(guestDescriptor, confirmedPhotoIds, faces);
  }

  const matchedPromises = scoreMatchesVectorized(referenceDescriptor, vectorData, thresholds);
  const matched = await Promise.all(matchedPromises);

  return noStoreJson({
    photos: matched,
    guest: { name: guest.name },
    source,
    thresholds,
    metric: "vectorized_euclidean_mapped",
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

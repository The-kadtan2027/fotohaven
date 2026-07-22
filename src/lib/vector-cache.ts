import { db } from "@/lib/db";
import { photoFaces, photos, ceremonies } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { parseDescriptor } from "@/lib/face-math";

export type AlbumFaceMeta = {
  id: string;
  photoId: string;
  storageKey: string;
  thumbnailKey: string | null;
  originalName: string;
};

export type AlbumVectorMatrix = {
  matrix: Float32Array; // Flattened N x 128 Float32Array
  norms: Float32Array;  // Precalculated vector norms ||a_i||^2 of size N
  faces: AlbumFaceMeta[];
  count: number;
  lastAccessed: number;
};

const cache = new Map<string, AlbumVectorMatrix>();
const TTL_MS = 15 * 60 * 1000; // 15 minutes LRU TTL

// Periodic LRU cleanup to manage memory on low-memory hardware
let cleanupInterval: NodeJS.Timeout | null = null;

function ensureCleanupTimer() {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [albumId, item] of cache.entries()) {
        if (now - item.lastAccessed > TTL_MS) {
          cache.delete(albumId);
        }
      }
      if (cache.size === 0 && cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
      }
    }, 5 * 60 * 1000);
    // Unref so timer doesn't block process exit
    if (cleanupInterval.unref) {
      cleanupInterval.unref();
    }
  }
}

export function invalidateAlbumVectorCache(albumId: string): void {
  cache.delete(albumId);
}

export function getAlbumVectorMatrix(albumId: string): AlbumVectorMatrix {
  ensureCleanupTimer();
  const cached = cache.get(albumId);
  if (cached) {
    cached.lastAccessed = Date.now();
    return cached;
  }

  // Fetch all face rows for original (non-return) photos in this album
  const rows = db
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

  const count = rows.length;
  const matrix = new Float32Array(count * 128);
  const norms = new Float32Array(count);
  const faces: AlbumFaceMeta[] = new Array(count);

  let validCount = 0;

  for (let i = 0; i < count; i++) {
    const row = rows[i];
    try {
      const vec = parseDescriptor(row.descriptor);
      if (vec.length !== 128) continue;

      const offset = validCount * 128;
      let normSq = 0;
      for (let k = 0; k < 128; k++) {
        const val = vec[k];
        matrix[offset + k] = val;
        normSq += val * val;
      }
      norms[validCount] = normSq;
      faces[validCount] = {
        id: row.id,
        photoId: row.photoId,
        storageKey: row.storageKey,
        thumbnailKey: row.thumbnailKey,
        originalName: row.originalName,
      };
      validCount++;
    } catch {
      // Ignore malformed descriptors
    }
  }

  // Slice matrix/norms if any invalid rows were skipped
  const finalMatrix = validCount === count ? matrix : matrix.subarray(0, validCount * 128);
  const finalNorms = validCount === count ? norms : norms.subarray(0, validCount);
  const finalFaces = validCount === count ? faces : faces.slice(0, validCount);

  const entry: AlbumVectorMatrix = {
    matrix: finalMatrix,
    norms: finalNorms,
    faces: finalFaces,
    count: validCount,
    lastAccessed: Date.now(),
  };

  cache.set(albumId, entry);
  return entry;
}

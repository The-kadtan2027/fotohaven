import { db } from "@/lib/db";
import { photoFaces, faceEmbeddings, photos, ceremonies } from "@/lib/schema";
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
  matrix: Float32Array; // Flattened N x vectorDim Float32Array
  norms: Float32Array;  // Precalculated vector norms ||a_i||^2 of size N
  faces: AlbumFaceMeta[];
  count: number;
  vectorDim: number;
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

  // 1. Fetch browser face_api descriptors (128-float)
  const photoFaceRows = db
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

  if (photoFaceRows.length > 0) {
    const count = photoFaceRows.length;
    const vectorDim = 128;
    const matrix = new Float32Array(count * vectorDim);
    const norms = new Float32Array(count);
    const faces: AlbumFaceMeta[] = new Array(count);
    let validCount = 0;

    for (let i = 0; i < count; i++) {
      const row = photoFaceRows[i];
      try {
        const vec = parseDescriptor(row.descriptor);
        if (vec.length !== vectorDim) continue;

        const offset = validCount * vectorDim;
        let normSq = 0;
        for (let k = 0; k < vectorDim; k++) {
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
        /* Ignore malformed descriptors */
      }
    }

    const entry: AlbumVectorMatrix = {
      matrix: validCount === count ? matrix : matrix.subarray(0, validCount * vectorDim),
      norms: validCount === count ? norms : norms.subarray(0, validCount),
      faces: validCount === count ? faces : faces.slice(0, validCount),
      count: validCount,
      vectorDim,
      lastAccessed: Date.now(),
    };

    cache.set(albumId, entry);
    return entry;
  }

  // 2. Fallback to native Python face_embeddings table (512-float vectors)
  const nativeRows = db
    .select({
      id: faceEmbeddings.id,
      photoId: faceEmbeddings.photoId,
      embedding: faceEmbeddings.embedding,
      storageKey: photos.storageKey,
      thumbnailKey: photos.thumbnailKey,
      originalName: photos.originalName,
    })
    .from(faceEmbeddings)
    .innerJoin(photos, eq(faceEmbeddings.photoId, photos.id))
    .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
    .where(and(eq(ceremonies.albumId, albumId), eq(photos.isReturn, false)))
    .all();

  const nativeCount = nativeRows.length;
  if (nativeCount === 0) {
    const emptyEntry: AlbumVectorMatrix = {
      matrix: new Float32Array(0),
      norms: new Float32Array(0),
      faces: [],
      count: 0,
      vectorDim: 512,
      lastAccessed: Date.now(),
    };
    cache.set(albumId, emptyEntry);
    return emptyEntry;
  }

  // Determine vector dimension from first valid embedding
  let detectedDim = 512;
  for (const row of nativeRows) {
    const raw = row.embedding as any;
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
      detectedDim = raw.byteLength / 4;
      break;
    }
  }

  const matrix = new Float32Array(nativeCount * detectedDim);
  const norms = new Float32Array(nativeCount);
  const faces: AlbumFaceMeta[] = new Array(nativeCount);
  let validCount = 0;

  for (let i = 0; i < nativeCount; i++) {
    const row = nativeRows[i];
    try {
      let vec: Float32Array;
      const raw = row.embedding as any;
      if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
        const buf = Buffer.from(raw);
        vec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      } else if (typeof raw === "string") {
        vec = parseDescriptor(raw);
      } else {
        continue;
      }

      if (vec.length !== detectedDim) continue;

      const offset = validCount * detectedDim;
      let normSq = 0;
      for (let k = 0; k < detectedDim; k++) {
        const val = vec[k];
        matrix[offset + k] = val;
        normSq += val * val;
      }
      norms[validCount] = normSq;
      faces[validCount] = {
        id: String(row.id),
        photoId: row.photoId,
        storageKey: row.storageKey,
        thumbnailKey: row.thumbnailKey,
        originalName: row.originalName,
      };
      validCount++;
    } catch {
      /* Ignore malformed embeddings */
    }
  }

  const entry: AlbumVectorMatrix = {
    matrix: validCount === nativeCount ? matrix : matrix.subarray(0, validCount * detectedDim),
    norms: validCount === nativeCount ? norms : norms.subarray(0, validCount),
    faces: validCount === nativeCount ? faces : faces.slice(0, validCount),
    count: validCount,
    vectorDim: detectedDim,
    lastAccessed: Date.now(),
  };

  cache.set(albumId, entry);
  return entry;
}

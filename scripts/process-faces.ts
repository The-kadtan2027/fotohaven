import path from "path";
import { Readable } from "stream";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { Canvas, Image, ImageData, loadImage } from "canvas";
import { db } from "../src/lib/db";
import { photoFaces, photos } from "../src/lib/schema";
import { getFileStream } from "../src/lib/storage";

type FaceMatchResult = {
  descriptor: Float32Array;
  detection: {
    box: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
};

type SourceMode = "auto" | "original" | "thumbnail";

const VALID_SOURCES: SourceMode[] = ["auto", "original", "thumbnail"];
const SOURCE_MODE = parseSourceMode(process.env.PROCESS_FACES_SOURCE);
const PROCESS_LIMIT = parsePositiveInt(process.env.PROCESS_FACES_LIMIT, 25);

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function parseSourceMode(value: string | undefined): SourceMode {
  const normalized = (value || "auto").toLowerCase();
  return (VALID_SOURCES as string[]).includes(normalized)
    ? (normalized as SourceMode)
    : "auto";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function getCandidateKeys(photo: { storageKey: string; thumbnailKey: string | null }): string[] {
  if (SOURCE_MODE === "original") return [photo.storageKey];
  if (SOURCE_MODE === "thumbnail") return photo.thumbnailKey ? [photo.thumbnailKey] : [];

  // auto = prefer thumbnail for speed, fallback to original for coverage.
  return photo.thumbnailKey ? [photo.thumbnailKey, photo.storageKey] : [photo.storageKey];
}

async function readPhotoBufferWithFallback(photo: {
  storageKey: string;
  thumbnailKey: string | null;
}): Promise<{ buffer: Buffer; sourceKey: string }> {
  const candidates = getCandidateKeys(photo);

  if (!candidates.length) {
    throw new Error("No usable key for configured source mode");
  }

  let lastError: unknown = null;
  for (const key of candidates) {
    try {
      const stream = (await getFileStream(key)) as Readable;
      const buffer = await streamToBuffer(stream);
      return { buffer, sourceKey: key };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to load photo stream");
}

async function loadFaceApi() {
  const faceapi = await import("face-api.js");
  faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);
  return faceapi;
}

async function main() {
  const startedAt = Date.now();
  const faceapi = await loadFaceApi();
  const modelRoot = path.join(process.cwd(), "public", "models");

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelRoot);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelRoot);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelRoot);

  const unprocessed = db
    .select({
      id: photos.id,
      storageKey: photos.storageKey,
      thumbnailKey: photos.thumbnailKey,
      faceProcessed: photos.faceProcessed,
    })
    .from(photos)
    .where(and(eq(photos.faceProcessed, false), eq(photos.isReturn, false)))
    .all();

  if (!unprocessed.length) {
    console.log("[process-faces] No pending photos.");
    return;
  }

  const pending = unprocessed.slice(0, PROCESS_LIMIT);
  console.log(
    `[process-faces] Found ${unprocessed.length} unprocessed photos. Processing ${pending.length} (source=${SOURCE_MODE}).`
  );

  let processedCount = 0;
  let faceCount = 0;
  for (const photo of pending) {
    const photoStartedAt = Date.now();
    try {
      const { buffer, sourceKey } = await readPhotoBufferWithFallback(photo);
      const img = await loadImage(buffer);

      const detections = (await faceapi
        .detectAllFaces(img as any)
        .withFaceLandmarks()
        .withFaceDescriptors()) as FaceMatchResult[];

      db.delete(photoFaces).where(eq(photoFaces.photoId, photo.id)).run();

      for (const detection of detections) {
        db.insert(photoFaces)
          .values({
            id: uuidv4(),
            photoId: photo.id,
            descriptor: JSON.stringify(Array.from(detection.descriptor)),
            boundingBox: JSON.stringify({
              x: detection.detection.box.x,
              y: detection.detection.box.y,
              width: detection.detection.box.width,
              height: detection.detection.box.height,
            }),
          })
          .run();
      }

      db.update(photos).set({ faceProcessed: true }).where(eq(photos.id, photo.id)).run();
      processedCount += 1;
      faceCount += detections.length;
      console.log(
        `[process-faces] Processed ${photo.id} (${detections.length} faces, source=${sourceKey}, ${Date.now() - photoStartedAt}ms).`
      );
    } catch (error) {
      console.error(`[process-faces] Failed for ${photo.id}:`, error);
      // Mark as processed so this script never blocks a queue forever on one bad file.
      db.update(photos).set({ faceProcessed: true }).where(eq(photos.id, photo.id)).run();
    }
  }

  const totalMs = Date.now() - startedAt;
  const perPhotoMs = processedCount > 0 ? Math.round(totalMs / processedCount) : 0;
  console.log(
    `[process-faces] Summary: processed=${processedCount}, faces=${faceCount}, elapsedMs=${totalMs}, avgMsPerPhoto=${perPhotoMs}`
  );
}

main()
  .then(() => {
    console.log("[process-faces] Done.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[process-faces] Fatal:", error);
    process.exit(1);
  });

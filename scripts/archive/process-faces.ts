process.env.TF_CPP_MIN_LOG_LEVEL = '3';
import path from "path";
import { Readable } from "stream";
import { and, eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { Canvas, Image, ImageData, loadImage } from "@napi-rs/canvas";
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
type DetectorMode = "tiny" | "ssd" | "hybrid";

const VALID_SOURCES: SourceMode[] = ["auto", "original", "thumbnail"];
const VALID_DETECTORS: DetectorMode[] = ["tiny", "ssd", "hybrid"];
const SOURCE_MODE = parseSourceMode(process.env.PROCESS_FACES_SOURCE);
const PROCESS_LIMIT = parsePositiveInt(process.env.PROCESS_FACES_LIMIT, 25);
const DETECTOR_MODE = parseDetectorMode(process.env.PROCESS_FACES_DETECTOR);
const TINY_INPUT = parsePositiveInt(process.env.PROCESS_FACES_TINY_INPUT, 128);
const TINY_SCORE = parseProbability(process.env.PROCESS_FACES_TINY_SCORE, 0.5);
const SSD_INPUT = parsePositiveInt(process.env.PROCESS_FACES_SSD_INPUT, 224);
const SSD_CONFIDENCE = parseProbability(process.env.PROCESS_FACES_SSD_CONFIDENCE, 0.5);

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

function parseProbability(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

function parseDetectorMode(value: string | undefined): DetectorMode {
  const normalized = (value || "hybrid").toLowerCase();
  return (VALID_DETECTORS as string[]).includes(normalized)
    ? (normalized as DetectorMode)
    : "hybrid";
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
  class CanvasCompat extends (Canvas as any) {
    constructor(width?: number, height?: number) {
      super(
        Number.isFinite(width as number) ? (width as number) : 1,
        Number.isFinite(height as number) ? (height as number) : 1
      );
    }
  }
  faceapi.env.monkeyPatch({ Canvas: CanvasCompat, Image, ImageData } as any);
  return faceapi;
}

async function main() {
  const startedAt = Date.now();
  const faceapi = await loadFaceApi();
  const modelRoot = path.join(process.cwd(), "public", "models");

  if (DETECTOR_MODE === "tiny" || DETECTOR_MODE === "hybrid") {
    await faceapi.nets.tinyFaceDetector.loadFromDisk(modelRoot);
  }
  if (DETECTOR_MODE === "ssd" || DETECTOR_MODE === "hybrid") {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelRoot);
  }
  await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(modelRoot);
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
    `[process-faces] Found ${unprocessed.length} unprocessed photos. Processing ${pending.length} (source=${SOURCE_MODE}, detector=${DETECTOR_MODE}).`
  );

  let processedCount = 0;
  let faceCount = 0;
  for (const photo of pending) {
    const photoStartedAt = Date.now();
    try {
      const { buffer, sourceKey } = await readPhotoBufferWithFallback(photo);
      const img = await loadImage(buffer);
      const canvas = new Canvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img as any, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const avg = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const stretched = Math.min(255, Math.max(0, (avg - 40) * 1.4));
        data[i] = data[i + 1] = data[i + 2] = stretched;
      }
      ctx.putImageData(imageData, 0, 0);

      const detectWithTiny = async () =>
        (await faceapi
          .detectAllFaces(
            canvas as any,
            new faceapi.TinyFaceDetectorOptions({
              scoreThreshold: TINY_SCORE,
              inputSize: TINY_INPUT,
            } as any)
          )
          .withFaceLandmarks(true)
          .withFaceDescriptors()) as FaceMatchResult[];

      const detectWithSsd = async () =>
        (await faceapi
          .detectAllFaces(
            canvas as any,
            new faceapi.SsdMobilenetv1Options({
              minConfidence: 0.3,
              inputSize: 416,
            } as any)
          )
          .withFaceLandmarks(true)
          .withFaceDescriptors()) as FaceMatchResult[];

      let detections: FaceMatchResult[] = [];
      if (DETECTOR_MODE === "tiny") {
        detections = await detectWithTiny();
      } else if (DETECTOR_MODE === "ssd") {
        detections = await detectWithSsd();
      } else {
        detections = await detectWithTiny();
        if (detections.length === 0) {
          detections = await detectWithSsd();
        }
      }

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
        `[process-faces] Processed ${photo.id} (${detections.length} faces, scores=${detections.map(d => (d.detection as any).score?.toFixed(2) ?? '?').join(',')}, source=${sourceKey}, ${Date.now() - photoStartedAt}ms).`
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

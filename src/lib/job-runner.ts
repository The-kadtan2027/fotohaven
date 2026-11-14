import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs/promises";
import sharp from "sharp";
import { eq, and, lt, lte, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobQueue, photos } from "@/lib/schema";
import { FACE_CONFIG } from "@/lib/face-config";
import { invalidateAlbumVectorCache } from "@/lib/vector-cache";
import { jobDueAt } from "@/lib/job-backoff";

export type JobType = "thumbnail" | "face_index" | "album_cleanup";
export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface ThumbnailJobPayload {
  resolvedPath: string;
  decodedKey: string;
}

export interface FaceIndexJobPayload {
  photoId: string;
  albumId: string;
  resolvedPath: string;
}

export interface CleanupJobPayload {
  filePaths: string[];
}

let isWorkerRunning = false;
let workerTimer: NodeJS.Timeout | null = null;

function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.NEXT_PHASE === "phase-export"
  );
}

export async function enqueueJob(
  type: JobType,
  payload: object,
  maxAttempts = 3
): Promise<string> {
  const jobId = uuidv4();
  const now = new Date();

  try {
    db.insert(jobQueue)
      .values({
        id: jobId,
        type,
        status: "pending",
        payload: JSON.stringify(payload),
        attempts: 0,
        maxAttempts,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    triggerWorker();
  } catch (err) {
    console.warn(`[JobRunner] Failed to enqueue ${type} job:`, err);
  }

  return jobId;
}

export function triggerWorker() {
  if (isWorkerRunning || isBuildPhase()) return;
  clearTimeout(workerTimer ?? undefined);

  workerTimer = setTimeout(() => {
    void processNextJob();
  }, 100);
}

async function processNextJob() {
  if (isWorkerRunning || isBuildPhase()) return;
  isWorkerRunning = true;

  try {
    const now = new Date();

    // 1. Recover stuck jobs (processing for > 5 minutes)
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);
    try {
      db.update(jobQueue)
        .set({ status: "pending", updatedAt: now })
        .where(and(eq(jobQueue.status, "processing"), lt(jobQueue.updatedAt, fiveMinsAgo)))
        .run();
    } catch (err: any) {
      if (err?.code === "SQLITE_ERROR" || err?.message?.includes("no such table")) {
        isWorkerRunning = false;
        return;
      }
      throw err;
    }

    // 2. Fetch oldest pending job that is due (updatedAt doubles as "not before")
    let job;
    try {
      job = db
        .select()
        .from(jobQueue)
        .where(and(eq(jobQueue.status, "pending"), lte(jobQueue.updatedAt, now)))
        .orderBy(jobQueue.createdAt)
        .get();
    } catch (err: any) {
      if (err?.code === "SQLITE_ERROR" || err?.message?.includes("no such table")) {
        isWorkerRunning = false;
        return;
      }
      throw err;
    }

    if (!job) {
      isWorkerRunning = false;
      return;
    }

    // Mark as processing
    const currentAttempts = job.attempts + 1;
    db.update(jobQueue)
      .set({
        status: "processing",
        attempts: currentAttempts,
        updatedAt: now,
      })
      .where(eq(jobQueue.id, job.id))
      .run();

    let handlerError: string | null = null;

    try {
      const payload = JSON.parse(job.payload);

      if (job.type === "thumbnail") {
        await handleThumbnailJob(payload as ThumbnailJobPayload);
      } else if (job.type === "face_index") {
        await handleFaceIndexJob(payload as FaceIndexJobPayload);
      } else if (job.type === "album_cleanup") {
        await handleCleanupJob(payload as CleanupJobPayload);
      }
    } catch (err) {
      handlerError = err instanceof Error ? err.message : String(err);
      console.error(`[JobRunner] Job ${job.id} (${job.type}) failed:`, handlerError);
    }

    const finishTime = new Date();

    if (!handlerError) {
      db.update(jobQueue)
        .set({
          status: "completed",
          lastError: null,
          updatedAt: finishTime,
        })
        .where(eq(jobQueue.id, job.id))
        .run();
      console.log(`[JobRunner] Job ${job.id} (${job.type}) completed successfully.`);
    } else {
      const isFinalAttempt = currentAttempts >= job.maxAttempts;
      db.update(jobQueue)
        .set({
          status: isFinalAttempt ? "failed" : "pending",
          lastError: handlerError,
          updatedAt: isFinalAttempt ? finishTime : jobDueAt(finishTime, currentAttempts),
        })
        .where(eq(jobQueue.id, job.id))
        .run();
      if (!isFinalAttempt) {
        const delay = jobDueAt(finishTime, currentAttempts).getTime() - finishTime.getTime();
        console.log(
          `[JobRunner] Job ${job.id} (${job.type}) will retry in ${Math.round(delay / 1000)}s (attempt ${currentAttempts}/${job.maxAttempts}).`
        );
      }
    }
  } catch (err) {
    console.error("[JobRunner] Unexpected worker loop error:", err);
  } finally {
    isWorkerRunning = false;

    // Wake for the next due job, or for the earliest backoff expiry.
    try {
      const now = new Date();
      const hasDue = db
        .select({ id: jobQueue.id })
        .from(jobQueue)
        .where(and(eq(jobQueue.status, "pending"), lte(jobQueue.updatedAt, now)))
        .get();

      if (hasDue) {
        triggerWorker();
      } else {
        const next = db
          .select({ updatedAt: jobQueue.updatedAt })
          .from(jobQueue)
          .where(eq(jobQueue.status, "pending"))
          .orderBy(jobQueue.updatedAt)
          .get();

        if (next) {
          const waitMs = Math.max(250, new Date(next.updatedAt).getTime() - now.getTime());
          clearTimeout(workerTimer ?? undefined);
          workerTimer = setTimeout(() => {
            void processNextJob();
          }, Math.min(waitMs, 60_000));
        }
      }
    } catch {
      // Ignore if table missing
    }
  }
}

// Handler: Downscaled Sharp JPEG Thumbnail Generation
async function handleThumbnailJob(payload: ThumbnailJobPayload) {
  const { resolvedPath, decodedKey } = payload;
  const parsedPath = path.parse(resolvedPath);
  const thumbFilename = `thumb_${parsedPath.name}.jpg`;
  const thumbResolved = path.join(parsedPath.dir, thumbFilename);
  const keyDir = decodedKey.includes("/")
    ? decodedKey.slice(0, decodedKey.lastIndexOf("/") + 1)
    : "";
  const thumbKey = `${keyDir}${thumbFilename}`;

  // Check if original file exists on disk
  try {
    await fs.access(resolvedPath);
  } catch {
    throw new Error(`Original photo file missing at ${resolvedPath}`);
  }

  await sharp(resolvedPath)
    .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toFile(thumbResolved);

  const result = db
    .update(photos)
    .set({ thumbnailKey: thumbKey })
    .where(eq(photos.storageKey, decodedKey))
    .run();

  // The photo was deleted while the job was queued: do not leave an orphan thumbnail.
  if (result.changes === 0) {
    await fs.unlink(thumbResolved).catch(() => {});
    console.warn(`[JobRunner] Thumbnail orphan removed for missing photo ${decodedKey}`);
  }
}

// Handler: Native Face Indexing Service Call
async function handleFaceIndexJob(payload: FaceIndexJobPayload) {
  const { photoId, albumId, resolvedPath } = payload;

  const backend = FACE_CONFIG.enrollmentBackend;
  const nativeUrl = FACE_CONFIG.localNativeServiceUrl || "http://127.0.0.1:5080";

  if (backend === "local_native_http" || backend === "remote_python") {
    const targetUrl = backend === "remote_python" ? FACE_CONFIG.remoteServiceUrl : nativeUrl;
    if (!targetUrl) throw new Error("Native face service URL not configured");

    const res = await fetch(`${targetUrl}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: resolvedPath, photoId, albumId }),
    });

    if (!res.ok) {
      throw new Error(`Native face extraction failed with status ${res.status}`);
    }

    invalidateAlbumVectorCache(albumId);
  }
}

// Handler: Safe Disk File Cleanup
async function handleCleanupJob(payload: CleanupJobPayload) {
  for (const filePath of payload.filePaths || []) {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore missing files
    }
  }
}

// Admin / Health Metrics Functions
export function getQueueMetrics() {
  try {
    const allJobs = db.select().from(jobQueue).orderBy(desc(jobQueue.createdAt)).all();

    const metrics = {
      pending: allJobs.filter((j) => j.status === "pending").length,
      processing: allJobs.filter((j) => j.status === "processing").length,
      completed: allJobs.filter((j) => j.status === "completed").length,
      failed: allJobs.filter((j) => j.status === "failed").length,
    };

    return { metrics, recentJobs: allJobs.slice(0, 20) };
  } catch (err: any) {
    if (err?.code === "SQLITE_ERROR" || err?.message?.includes("no such table")) {
      return {
        metrics: { pending: 0, processing: 0, completed: 0, failed: 0 },
        recentJobs: [],
      };
    }
    throw err;
  }
}

export function retryFailedJobs() {
  try {
    db.update(jobQueue)
      .set({ status: "pending", attempts: 0, lastError: null, updatedAt: new Date() })
      .where(eq(jobQueue.status, "failed"))
      .run();

    triggerWorker();
  } catch {
    // Ignore if table missing
  }
}

export function clearCompletedJobs() {
  try {
    db.delete(jobQueue).where(eq(jobQueue.status, "completed")).run();
  } catch {
    // Ignore if table missing
  }
}

// Auto-trigger worker loop on server runtime startup (skips Next.js build phase)
if (!isBuildPhase()) {
  triggerWorker();
}

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import sharp from "sharp";
import { db } from "@/lib/db";
import { photos } from "@/lib/schema";
import { eq } from "drizzle-orm";

// --- Background Thumbnail Queue for Android ---
// Sharp WASM can take 15+ seconds per image on a low-end phone. 
// If we block the PUT response, the HTTP tunnel connection times out.
// We use a global queue to run ONE sharp process at a time in the background.

type ThumbTask = {
  resolvedPath: string;
  decodedKey: string;
};

const thumbQueue: ThumbTask[] = [];
let isProcessingThumbs = false;

async function processThumbnails() {
  if (isProcessingThumbs) return;
  isProcessingThumbs = true;

  while (thumbQueue.length > 0) {
    const task = thumbQueue.shift();
    if (!task) continue;

    try {
      // Small buffer delay to ensure frontend has finished POSTing the database record creation
      await new Promise(r => setTimeout(r, 2000));

      const parsedPath = path.parse(task.resolvedPath);
      const thumbFilename = `thumb_${parsedPath.name}.jpg`;
      const thumbResolved = path.join(parsedPath.dir, thumbFilename);
      const thumbKey = task.decodedKey.replace(parsedPath.base, thumbFilename);

      await sharp(task.resolvedPath)
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toFile(thumbResolved);

      // Update DB to link thumbnail
      await db
        .update(photos)
        .set({ thumbnailKey: thumbKey })
        .where(eq(photos.storageKey, task.decodedKey));

      console.log(`[Queue] Successfully generated thumbnail for ${task.decodedKey}`);
    } catch (err) {
      console.error("[Queue] Failed to process thumbnail:", err);
    }
  }

  isProcessingThumbs = false;
}
// ----------------------------------------------

// POST /api/upload/local?key=<encoded-storage-key>
// In local storage mode, the browser can't PUT directly to a filesystem path.
// Instead, getPresignedUploadUrl() returns this route as the "upload URL".
//
// ── Android optimisation ──
// Uses a streaming pipeline (req.body → disk) so a 20 MB upload uses ~64 KB
// of heap instead of buffering the entire file in memory.

const UPLOAD_BASE =
  process.env.LOCAL_UPLOAD_PATH ||
  "/data/data/com.termux/files/home/storage/shared/fotohaven";

// Disable Next.js body parsing — we stream the raw body ourselves
export const dynamic = "force-dynamic";

// Max file size accepted by this route (matches the metadata route limit)
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

async function handleUpload(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
    }

    if (!req.body) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    const decodedKey = decodeURIComponent(key);
    const filePath = path.join(UPLOAD_BASE, decodedKey);

    // Security: prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOAD_BASE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Ensure parent directories exist
    await fs.mkdir(path.dirname(resolved), { recursive: true });

    // ── Streaming pipeline: Web ReadableStream → Node Readable → disk ──
    // This avoids buffering the entire file in memory.
    const nodeReadable = Readable.fromWeb(req.body as import("stream/web").ReadableStream);
    const writeStream = createWriteStream(resolved);

    let bytesWritten = 0;

    // Track bytes and enforce size limit mid-stream
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > MAX_UPLOAD_BYTES) {
          callback(new Error(`File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(nodeReadable, sizeGuard, writeStream);

    // ── Generate Thumbnail (Background Queue) ──
    // Push the file paths to the module-level queue and kick off processing without awaiting.
    thumbQueue.push({ resolvedPath: resolved, decodedKey });
    processThumbnails().catch((err) => console.error("[ThumbWorker] Fatal Error:", err));

    return new NextResponse(null, { status: 200 });
  } catch (err: any) {
    console.error("[PUT /api/upload/local]", err);

    // Clean up partial file on error
    try {
      const key = new URL(req.url).searchParams.get("key");
      if (key) {
        const filePath = path.join(UPLOAD_BASE, decodeURIComponent(key));
        await fs.unlink(filePath).catch(() => {});
      }
    } catch { /* best effort */ }

    if (err?.message?.includes("limit")) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

export { handleUpload as PUT, handleUpload as POST };

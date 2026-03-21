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
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB

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

    // ── Generate Thumbnail ──
    try {
      const parsedPath = path.parse(resolved);
      const thumbFilename = `thumb_${parsedPath.name}.jpg`;
      const thumbResolved = path.join(parsedPath.dir, thumbFilename);
      // Create thumbnail key matching the storageKey format (always forward slashes)
      const thumbKey = decodedKey.replace(parsedPath.base, thumbFilename);

      await sharp(resolved)
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toFile(thumbResolved);

      // Update DB
      await db
        .update(photos)
        .set({ thumbnailKey: thumbKey })
        .where(eq(photos.storageKey, decodedKey));
    } catch (thumbErr) {
      console.error("[PUT /api/upload/local] Thumbnail generation failed:", thumbErr);
    }

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

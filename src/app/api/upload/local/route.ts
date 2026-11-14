import { NextResponse } from "next/server";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { enqueueJob } from "@/lib/job-runner";
import { logger } from "@/lib/logger";
import { withHandler, apiBadRequest, apiForbidden, apiError } from "@/lib/api-response";

const UPLOAD_BASE =
  process.env.LOCAL_UPLOAD_PATH ||
  "/data/data/com.termux/files/home/storage/shared/fotohaven";

export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

async function handleUpload(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");

  if (!key) {
    return apiBadRequest("Missing key parameter");
  }

  if (!req.body) {
    return apiBadRequest("Empty body");
  }

  const decodedKey = decodeURIComponent(key);
  const filePath = path.join(UPLOAD_BASE, decodedKey);

  // Security: prevent path traversal
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(UPLOAD_BASE))) {
    logger.warn("STORAGE", `Path traversal attempt rejected: ${decodedKey}`);
    return apiForbidden("Forbidden");
  }

  // Ensure parent directories exist
  await fs.mkdir(path.dirname(resolved), { recursive: true });

  const nodeReadable = Readable.fromWeb(req.body as import("stream/web").ReadableStream);
  const writeStream = createWriteStream(resolved);

  let bytesWritten = 0;

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

  try {
    await pipeline(nodeReadable, sizeGuard, writeStream);
  } catch (err: any) {
    // Clean up partial file on error
    try {
      await fs.unlink(resolved).catch(() => {});
    } catch {
      /* best effort */
    }

    if (err?.message?.includes("limit")) {
      return apiError(err.message, { status: 413, code: "PAYLOAD_TOO_LARGE" });
    }
    throw err;
  }

  logger.info("STORAGE", `File upload saved: ${decodedKey} (${bytesWritten} bytes)`);

  // Enqueue Persistent Background Thumbnail Job
  try {
    await enqueueJob("thumbnail", { resolvedPath: resolved, decodedKey });
  } catch (err) {
    logger.warn("JOB", "Thumbnail enqueue warning:", err);
  }

  return new NextResponse(null, { status: 200 });
}

const wrappedUpload = withHandler("POST/PUT /api/upload/local", handleUpload);

export { wrappedUpload as PUT, wrappedUpload as POST };

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { createReadStream, statSync } from "fs";
import { Readable } from "stream";

// GET /api/files/[...key]
// Serves locally-stored photos from UPLOAD_BASE.
//
// ── Android optimisation ──
// • Supports HTTP Range requests (206 Partial Content) for resumable
//   downloads over Cloudflare Tunnel and efficient large-image loading.
// • Sends ETag for browser caching (avoids re-downloading unchanged files).
// • Streams directly from disk — never buffers the full file in memory.

const UPLOAD_BASE =
  process.env.LOCAL_UPLOAD_PATH ||
  "/data/data/com.termux/files/home/storage/shared/fotohaven";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".gif": "image/gif",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    const { key } = await params;

    // key is an array of path segments from the [...key] catch-all
    // storage.ts encodes the whole key as a single segment via encodeURIComponent
    let decodedKey: string;
    if (key.length === 1) {
      decodedKey = decodeURIComponent(key[0]);
    } else {
      decodedKey = key.map(decodeURIComponent).join("/");
    }

    const filePath = path.join(UPLOAD_BASE, decodedKey);

    // Security: prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(UPLOAD_BASE))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check file exists + get stats
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ext = path.extname(resolved).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const fileSize = stat.size;
    // ETag based on mtime + size (cheap to compute, good enough for immutable photos)
    const etag = `"${stat.mtimeMs.toString(36)}-${fileSize.toString(36)}"`;

    // ── Conditional request (304 Not Modified) ──
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304 });
    }

    // ── Common headers ──
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400, immutable",
      "ETag": etag,
    };

    // ── Range request handling (206 Partial Content) ──
    const rangeHeader = req.headers.get("range");
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        // Validate range
        if (start >= fileSize || end >= fileSize || start > end) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          });
        }

        const chunkSize = end - start + 1;
        const stream = createReadStream(resolved, { start, end });
        const readableStream = Readable.toWeb(stream) as ReadableStream;

        return new NextResponse(readableStream, {
          status: 206,
          headers: {
            ...headers,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          },
        });
      }
    }

    // ── Full file response ──
    const stream = createReadStream(resolved);
    const readableStream = Readable.toWeb(stream) as ReadableStream;

    return new NextResponse(readableStream, {
      status: 200,
      headers: {
        ...headers,
        "Content-Length": String(fileSize),
      },
    });
  } catch (err) {
    console.error("[GET /api/files]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

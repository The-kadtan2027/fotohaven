import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { createReadStream, statSync } from "fs";
import { Readable } from "stream";

// GET /api/files/[...key]
// Serves locally-stored photos from UPLOAD_BASE.
// The key is the storage key (e.g. albums/uuid/ceremonies/uuid/photoId/filename.jpg)
// encoded as a single URL param via encodeURIComponent in storage.ts.

const UPLOAD_BASE =
  process.env.LOCAL_UPLOAD_PATH ||
  "/data/data/com.termux/files/home/storage/shared/fotohaven";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    const { key } = await params;

    // key is an array of path segments from the [...key] catch-all
    // but storage.ts encodes the whole key as a single segment via encodeURIComponent
    // Handle both cases: single encoded segment or already-decoded multi-segment
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

    // Check file exists
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Derive content type from extension
    const ext = path.extname(resolved).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".heic": "image/heic",
      ".heif": "image/heif",
      ".gif": "image/gif",
    };
    const contentType = contentTypeMap[ext] ?? "application/octet-stream";

    // Stream the file
    const stream = createReadStream(resolved);
    const readableStream = Readable.toWeb(stream) as ReadableStream;

    return new NextResponse(readableStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[GET /api/files]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

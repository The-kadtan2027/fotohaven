import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// POST /api/upload/local?key=<encoded-storage-key>
// In local storage mode, the browser can't PUT directly to a filesystem path.
// Instead, getPresignedUploadUrl() returns this route as the "upload URL".
// The client sends the file as the raw request body (same PUT semantics as R2).

const UPLOAD_BASE =
  process.env.LOCAL_UPLOAD_PATH ||
  "/data/data/com.termux/files/home/storage/shared/fotohaven";

export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "Missing key parameter" }, { status: 400 });
    }

    const decodedKey = decodeURIComponent(key);
    const filePath = path.join(UPLOAD_BASE, decodedKey);

    // Ensure parent directories exist
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write the raw body to disk
    const arrayBuffer = await req.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));

    return new NextResponse(null, { status: 200 });
  } catch (err) {
    console.error("[PUT /api/upload/local]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

// Also accept POST for any clients that send POST instead of PUT
export { PUT as POST };

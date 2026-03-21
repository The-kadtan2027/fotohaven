import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUploadUrl, buildPhotoKey } from "@/lib/storage";
import { UploadPhotoPayload, UploadPhotoResponse } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { ceremonies, photos } from "@/lib/schema";
import { eq } from "drizzle-orm";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_SIZE = 35 * 1024 * 1024; // 35 MB — tuned for Android (6 GB RAM)

// POST /api/upload
// Step 1: Client requests a presigned upload URL
// Step 2: Client uploads file directly to R2 (no server bandwidth used)
// Step 3: Client confirms upload via POST /api/upload/confirm
export async function POST(req: NextRequest) {
  try {
    const body: UploadPhotoPayload = await req.json();

    if (!body.ceremonyId || !body.filename || !body.contentType) {
      return NextResponse.json({ error: "ceremonyId, filename, contentType required" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(body.contentType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    if (body.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
    }

    // Verify ceremony exists and get albumId
    const ceremony = await db.query.ceremonies.findFirst({
      where: eq(ceremonies.id, body.ceremonyId),
      columns: { id: true, albumId: true },
    });

    if (!ceremony) {
      return NextResponse.json({ error: "Ceremony not found" }, { status: 404 });
    }

    const photoId = uuidv4();
    const ext = body.filename.split(".").pop() ?? "jpg";
    const safeFilename = `${photoId}.${ext}`;
    const storageKey = buildPhotoKey(ceremony.albumId, ceremony.id, photoId, safeFilename);

    // Create the DB record immediately (status can be tracked later)
    db.insert(photos).values({
      id: photoId,
      filename: safeFilename,
      originalName: body.filename,
      size: body.size,
      mimeType: body.contentType,
      storageKey,
      ceremonyId: body.ceremonyId,
      createdAt: new Date(),
    }).run();

    // Return a presigned PUT URL — client uploads directly to R2
    const uploadUrl = await getPresignedUploadUrl(storageKey, body.contentType);

    const response: UploadPhotoResponse = { photoId, uploadUrl, storageKey };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error("[POST /api/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

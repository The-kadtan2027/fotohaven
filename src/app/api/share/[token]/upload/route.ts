import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUploadUrl, buildPhotoKey } from "@/lib/storage";
import { ReturnUploadPayload, UploadPhotoResponse } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { albums, ceremonies, photos } from "@/lib/schema";
import { eq } from "drizzle-orm";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

// POST /api/share/[token]/upload
// Photographer uploads edited finals back into an album via its share link.
// Sets isReturn: true on the created Photo record.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Verify album exists via token
    const album = await db.query.albums.findFirst({
      where: eq(albums.shareToken, token),
      columns: { id: true, title: true, expiresAt: true },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Check expiry
    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    const body: ReturnUploadPayload = await req.json();

    if (!body.ceremonyId || !body.filename || !body.contentType) {
      return NextResponse.json(
        { error: "ceremonyId, filename, contentType required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_TYPES.includes(body.contentType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    if (body.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large (max 50MB)" }, { status: 400 });
    }

    // Verify the ceremony belongs to this album (security check)
    const ceremony = await db.query.ceremonies.findFirst({
      where: eq(ceremonies.id, body.ceremonyId),
      columns: { id: true, albumId: true },
    });

    if (!ceremony || ceremony.albumId !== album.id) {
      return NextResponse.json({ error: "Ceremony not found" }, { status: 404 });
    }

    const photoId = uuidv4();
    const ext = body.filename.split(".").pop() ?? "jpg";
    const safeFilename = `${photoId}.${ext}`;
    const storageKey = buildPhotoKey(album.id, ceremony.id, photoId, safeFilename);

    // Insert DB record with isReturn: true
    db.insert(photos).values({
      id: photoId,
      filename: safeFilename,
      originalName: body.filename,
      size: body.size,
      mimeType: body.contentType,
      storageKey,
      ceremonyId: body.ceremonyId,
      isReturn: true,
      returnOf: body.returnOf ?? null,
      createdAt: new Date(),
    }).run();

    // Return presigned URL so the client uploads directly to storage
    const uploadUrl = await getPresignedUploadUrl(storageKey, body.contentType);

    const response: UploadPhotoResponse = { photoId, uploadUrl, storageKey };
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error("[POST /api/share/:token/upload]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

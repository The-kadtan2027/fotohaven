import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { Readable } from "stream";
import { getFileStream } from "@/lib/storage";
import { getOptionalGuestFromRequest, logActivity } from "@/lib/activity-log";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  
  const formData = await req.formData();
  const photoIdsRaw = formData.get("photoIds");
  const bundleName = formData.get("bundleName") || "Download";

  if (!photoIdsRaw || typeof photoIdsRaw !== "string") {
    return NextResponse.json({ error: "Missing or invalid photoIds" }, { status: 400 });
  }

  let photoIds: string[];
  try {
    photoIds = JSON.parse(photoIdsRaw);
  } catch {
    return NextResponse.json({ error: "Invalid photoIds JSON" }, { status: 400 });
  }

  // Verify album exists
  const album = await db.query.albums.findFirst({
    where: eq(albums.shareToken, token),
    with: { ceremonies: { with: { photos: true } } },
  });

  if (!album) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  // Find valid photos
  const allPhotos = album.ceremonies.flatMap((c) => c.photos);
  const requestedPhotos = allPhotos.filter(p => photoIds.includes(p.id));

  if (requestedPhotos.length === 0) {
    return NextResponse.json({ error: "No valid photos found" }, { status: 404 });
  }

  try {
    const guest = await getOptionalGuestFromRequest(req, album.id);
    logActivity({
      albumId: album.id,
      guestId: guest?.id ?? null,
      eventType: "download_started",
      payload: {
        count: requestedPhotos.length,
        bundleName,
      },
    });
  } catch (err) {
    console.warn("[DOWNLOAD_LOG]", err);
  }

  // 0 zlib compression because JPEGs don't compress — saves massive CPU time
  const archive = archiver("zip", {
    zlib: { level: 0 }, 
  });

  const readableStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  // Background appending (we return the streaming Response instantly)
  (async () => {
    for (const photo of requestedPhotos) {
      try {
        // Always fallback to original high-res storage key
        const stream = await getFileStream(photo.storageKey);
        archive.append(stream as any, { name: photo.originalName });
      } catch (err) {
        console.error(`[ZIP Stream] Failed to append ${photo.id}:`, err);
      }
    }
    archive.finalize();
  })();

  const formattedName = encodeURIComponent((bundleName as string).replace(/[^a-zA-Z0-9.\-_\s]/g, "").trim());

  return new NextResponse(readableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${formattedName}.zip"`,
    },
  });
}

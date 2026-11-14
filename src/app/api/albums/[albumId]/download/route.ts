import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { Readable } from "stream";
import { getFileStream, fileExists } from "@/lib/storage";

export async function POST(req: NextRequest, { params }: { params: Promise<{ albumId: string }> }) {
  const albumId = (await params).albumId;
  
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

  const album = await db.query.albums.findFirst({
    where: eq(albums.id, albumId),
    with: { ceremonies: { with: { photos: true } } },
  });

  if (!album) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  const allPhotos = album.ceremonies.flatMap((c) => c.photos);
  const requestedPhotos = allPhotos.filter(p => photoIds.includes(p.id));

  if (requestedPhotos.length === 0) {
    return NextResponse.json({ error: "No valid photos found" }, { status: 404 });
  }

  const archive = archiver("zip", {
    zlib: { level: 0 }, 
  });
  archive.on("error", (err) => {
    console.error("[ZIP Stream] archive error:", err);
  });

  const readableStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  // Background appending
  void (async () => {
    for (const photo of requestedPhotos) {
      try {
        if (!(await fileExists(photo.storageKey))) {
          console.warn(`[ZIP Stream] Missing file for ${photo.id}; skipping`);
          continue;
        }
        const stream = await getFileStream(photo.storageKey);
        stream.on("error", (err) => {
          console.error(`[ZIP Stream] Read error for ${photo.id}:`, err);
        });
        archive.append(stream, { name: photo.originalName });
      } catch (err) {
        console.error(`[ZIP Stream] Failed to append ${photo.id}:`, err);
      }
    }
    await archive.finalize().catch((err) => {
      console.error("[ZIP Stream] finalize failed:", err);
    });
  })();

  const formattedName = encodeURIComponent((bundleName as string).replace(/[^a-zA-Z0-9.\-_\s]/g, "").trim());

  return new NextResponse(readableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${formattedName}.zip"`,
    },
  });
}

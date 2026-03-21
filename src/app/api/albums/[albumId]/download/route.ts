import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { getFileStream } from "@/lib/storage";

function streamArchiverToWeb(archive: archiver.Archiver) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  archive.on("data", (chunk) => writer.write(chunk));
  archive.on("end", () => writer.close());
  archive.on("error", (err) => writer.abort(err));

  return readable;
}

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

  const readableStream = streamArchiverToWeb(archive);

  // Background appending
  (async () => {
    for (const photo of requestedPhotos) {
      try {
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

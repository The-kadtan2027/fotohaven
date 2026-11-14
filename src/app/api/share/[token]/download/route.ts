import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";
import archiver from "archiver";
import { Readable } from "stream";
import { getFileStream, fileExists } from "@/lib/storage";
import { getOptionalGuestFromRequest, logActivity } from "@/lib/activity-log";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token;
  
  const formData = await req.formData();
  const photoIdsRaw = formData.get("photoIds");
  const bundleName = formData.get("bundleName") || "Download";
  const scope = formData.get("scope"); // "all" | "ceremony" | "finals" | undefined
  const ceremonyId = formData.get("ceremonyId");
  const formPassword = formData.get("password");

  // Verify album exists
  const album = await db.query.albums.findFirst({
    where: eq(albums.shareToken, token),
    with: { ceremonies: { with: { photos: true } } },
  });

  if (!album) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }

  // Expiry and password must match every other share endpoint (F-06).
  if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  if (album.password) {
    const authHeader = req.headers.get("Authorization");
    const provided =
      (authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null) ??
      (typeof formPassword === "string" ? formPassword : null);

    if (!provided) {
      return NextResponse.json({ passwordRequired: true }, { status: 401 });
    }

    const match = await bcrypt.compare(provided, album.password);
    if (!match) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
  }

  let requestedPhotos;

  if (scope === "all") {
    requestedPhotos = album.ceremonies.flatMap((c) => c.photos);
  } else if (scope === "finals") {
    requestedPhotos = album.ceremonies.flatMap((c) => c.photos.filter((p) => p.isReturn));
  } else if (scope === "ceremony" && ceremonyId) {
    const ceremony = album.ceremonies.find(c => c.id === ceremonyId);
    requestedPhotos = ceremony?.photos || [];
  } else {
    if (!photoIdsRaw || typeof photoIdsRaw !== "string") {
      return NextResponse.json({ error: "Missing or invalid photoIds" }, { status: 400 });
    }

    let photoIds: string[];
    try {
      photoIds = JSON.parse(photoIdsRaw);
    } catch {
      return NextResponse.json({ error: "Invalid photoIds JSON" }, { status: 400 });
    }

    const allPhotos = album.ceremonies.flatMap((c) => c.photos);
    requestedPhotos = allPhotos.filter(p => photoIds.includes(p.id));
  }

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
  archive.on("error", (err) => {
    console.error("[ZIP Stream] archive error:", err);
  });

  const readableStream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  // Background appending (we return the streaming Response instantly)
  void (async () => {
    for (const photo of requestedPhotos) {
      try {
        if (!(await fileExists(photo.storageKey))) {
          console.warn(`[ZIP Stream] Missing file for ${photo.id}; skipping`);
          continue;
        }
        // Always fallback to original high-res storage key
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

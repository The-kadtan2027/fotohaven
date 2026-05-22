import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUrl } from "@/lib/storage";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  try {
    const { albumId } = await params;

    const album = await db.query.albums.findFirst({
      where: eq(albums.id, albumId),
      with: {
        ceremonies: {
          orderBy: (c, { asc }) => [asc(c.order)],
          with: {
            photos: {
              orderBy: (p, { desc }) => [desc(p.createdAt)],
              with: {
                comments: true,
              },
            },
          },
        },
        activityLogs: {
          orderBy: (l, { desc }) => [desc(l.createdAt)],
          with: {
            guest: true,
          },
        },
      },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Generate presigned URLs for all photos
    const albumWithUrls = {
      ...album,
      ceremonies: await Promise.all(
        album.ceremonies.map(async (ceremony: any) => ({
          ...ceremony,
          photos: await Promise.all(
            ceremony.photos.map(async (photo: any) => ({
              ...photo,
              url: await getPresignedUrl(photo.thumbnailKey || photo.storageKey),
              originalUrl: await getPresignedUrl(photo.storageKey),
            }))
          ),
        }))
      ),
    };

    return NextResponse.json(albumWithUrls);
  } catch (error) {
    console.error("[GET_ALBUM]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  try {
    const { albumId } = await params;
    const album = await db.query.albums.findFirst({
      where: eq(albums.id, albumId),
      columns: { id: true },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const body = await req.json();
    const updates: Partial<{
      compressionQuality: number;
      compressionFormat: "jpeg" | "webp" | "original";
      dedupThreshold: number;
      updatedAt: Date;
    }> = {};

    if (body.compressionQuality !== undefined) {
      if (typeof body.compressionQuality !== "number" || body.compressionQuality < 10 || body.compressionQuality > 100) {
        return NextResponse.json({ error: "compressionQuality must be between 10 and 100" }, { status: 400 });
      }
      updates.compressionQuality = Math.round(body.compressionQuality);
    }

    if (body.compressionFormat !== undefined) {
      if (body.compressionFormat !== "jpeg" && body.compressionFormat !== "webp" && body.compressionFormat !== "original") {
        return NextResponse.json({ error: "compressionFormat must be jpeg, webp, or original" }, { status: 400 });
      }
      updates.compressionFormat = body.compressionFormat;
    }

    if (body.dedupThreshold !== undefined) {
      if (typeof body.dedupThreshold !== "number" || body.dedupThreshold < 1 || body.dedupThreshold > 20) {
        return NextResponse.json({ error: "dedupThreshold must be between 1 and 20" }, { status: 400 });
      }
      updates.dedupThreshold = Math.round(body.dedupThreshold);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
    }

    updates.updatedAt = new Date();

    await db.update(albums).set(updates).where(eq(albums.id, albumId)).run();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/albums]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  try {
    const { albumId } = await params;

    const album = await db.query.albums.findFirst({
      where: eq(albums.id, albumId),
      with: {
        ceremonies: {
          with: { photos: true },
        },
      },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Call deleteFile on all photos
    const { deleteFile } = await import("@/lib/storage");
    for (const ceremony of album.ceremonies) {
      for (const photo of ceremony.photos) {
        await deleteFile(photo.storageKey);
        if (photo.thumbnailKey) {
          await deleteFile(photo.thumbnailKey);
        }
      }
    }

    // Delete album from database (cascade deletes ceremonies, photos, comments)
    await db.delete(albums).where(eq(albums.id, albumId)).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/albums]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

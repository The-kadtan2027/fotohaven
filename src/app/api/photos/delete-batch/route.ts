import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ceremonies, photos } from "@/lib/schema";
import { eq, inArray } from "drizzle-orm";
import { deleteFile } from "@/lib/storage";
import { invalidateAlbumVectorCache } from "@/lib/vector-cache";

export async function POST(req: NextRequest) {
  try {
    const { photoIds } = await req.json();

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return NextResponse.json(
        { error: "photoIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // Look up the photo records to retrieve their storageKeys and album
    const photoRecords = db
      .select({
        id: photos.id,
        storageKey: photos.storageKey,
        thumbnailKey: photos.thumbnailKey,
        albumId: ceremonies.albumId,
      })
      .from(photos)
      .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
      .where(inArray(photos.id, photoIds))
      .all();

    if (photoRecords.length === 0) {
       return NextResponse.json({ success: true, deletedCount: 0 });
    }

    // Delete files from storage
    for (const photo of photoRecords) {
      await deleteFile(photo.storageKey);
      if (photo.thumbnailKey) {
        await deleteFile(photo.thumbnailKey);
      }
    }

    // Delete photos from DB in one query
    await db.delete(photos).where(inArray(photos.id, photoIds)).run();

    for (const albumId of new Set(photoRecords.map((photo) => photo.albumId))) {
      invalidateAlbumVectorCache(albumId);
    }

    return NextResponse.json({ success: true, deletedCount: photoRecords.length });
  } catch (error) {
    console.error("[POST /api/photos/delete-batch]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

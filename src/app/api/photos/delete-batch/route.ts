import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { photos } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { deleteFile } from "@/lib/storage";

export async function POST(req: NextRequest) {
  try {
    const { photoIds } = await req.json();

    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return NextResponse.json(
        { error: "photoIds must be a non-empty array" },
        { status: 400 }
      );
    }

    // Look up the photo records to retrieve their storageKeys
    const photoRecords = await db.query.photos.findMany({
      where: inArray(photos.id, photoIds),
    });

    if (photoRecords.length === 0) {
       return NextResponse.json({ success: true, deletedCount: 0 });
    }

    // Delete files from storage
    for (const photo of photoRecords) {
      await deleteFile(photo.storageKey);
    }

    // Delete photos from DB in one query
    await db.delete(photos).where(inArray(photos.id, photoIds)).run();

    return NextResponse.json({ success: true, deletedCount: photoRecords.length });
  } catch (error) {
    console.error("[POST /api/photos/delete-batch]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

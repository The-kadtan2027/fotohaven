import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { photos } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { deleteFile } from "@/lib/storage";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  try {
    const { photoId } = await params;

    // Look up the photo to get its storageKey
    const photo = await db.query.photos.findFirst({
      where: eq(photos.id, photoId),
    });

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    // Call deleteFile(photo.storageKey)
    await deleteFile(photo.storageKey);
    if (photo.thumbnailKey) {
      await deleteFile(photo.thumbnailKey);
    }

    // Delete the photo from the database
    await db.delete(photos).where(eq(photos.id, photoId)).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/photos]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

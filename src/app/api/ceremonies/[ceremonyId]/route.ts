import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ceremonies } from "@/lib/schema";
import { eq } from "drizzle-orm";

// DELETE /api/ceremonies/[ceremonyId]
// Deletes a ceremony, purges its files from storage, and cascades deletion in the DB
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ ceremonyId: string }> }
) {
  try {
    const { ceremonyId } = await params;

    // Fetch the ceremony and eagerly load all its photos
    const ceremony = await db.query.ceremonies.findFirst({
      where: eq(ceremonies.id, ceremonyId),
      with: { photos: true },
    });

    if (!ceremony) {
      return NextResponse.json({ error: "Ceremony not found" }, { status: 404 });
    }

    // Purge corresponding photo and thumbnail objects from local disk/R2
    const { deleteFile } = await import("@/lib/storage");
    for (const photo of ceremony.photos) {
      await deleteFile(photo.storageKey);
      if (photo.thumbnailKey) {
        await deleteFile(photo.thumbnailKey);
      }
    }

    // Delete the ceremony row. Drizzle Cascade explicitly deletes the photos and comments.
    await db.delete(ceremonies).where(eq(ceremonies.id, ceremonyId)).run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/ceremonies/[ceremonyId]]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ceremonies, photos } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { deleteFile } from "@/lib/storage";
import { getOptionalGuestFromRequest, logActivity } from "@/lib/activity-log";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  try {
    const { photoId } = await params;

    // Validate photo exists
    const photo = db
      .select({
        id: photos.id,
        isSelected: photos.isSelected,
        albumId: ceremonies.albumId,
      })
      .from(photos)
      .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
      .where(eq(photos.id, photoId))
      .get();

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const body = await req.json();
    const updates: Partial<{ isSelected: boolean; imageHash: string | null }> = {};

    if ("isSelected" in body) {
      if (typeof body.isSelected !== "boolean") {
        return NextResponse.json(
          { error: "isSelected must be a boolean" },
          { status: 400 }
        );
      }
      updates.isSelected = body.isSelected;
    }

    if ("imageHash" in body) {
      if (body.imageHash !== null && (typeof body.imageHash !== "string" || !/^[0-9a-f]{16}$/i.test(body.imageHash))) {
        return NextResponse.json(
          { error: "imageHash must be a 16-character hex string or null" },
          { status: 400 }
        );
      }
      updates.imageHash = body.imageHash;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No supported fields provided" },
        { status: 400 }
      );
    }

    db.update(photos)
      .set(updates)
      .where(eq(photos.id, photoId))
      .run();

    if (
      Object.prototype.hasOwnProperty.call(body, "isSelected") &&
      photo.isSelected !== updates.isSelected
    ) {
      try {
        const guest = await getOptionalGuestFromRequest(req, photo.albumId);
        logActivity({
          albumId: photo.albumId,
          guestId: guest?.id ?? null,
          eventType: updates.isSelected ? "photo_selected" : "photo_deselected",
          payload: { photoId },
        });
      } catch (error) {
        console.warn("[PHOTO_SELECTION_LOG]", error);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/photos]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

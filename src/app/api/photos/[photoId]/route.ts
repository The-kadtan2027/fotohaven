import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ceremonies, photos } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { deleteFile } from "@/lib/storage";
import { getOptionalGuestFromRequest, logActivity } from "@/lib/activity-log";
import { logger } from "@/lib/logger";
import { withHandler, apiSuccess, apiBadRequest, apiNotFound } from "@/lib/api-response";

type Context = { params: Promise<{ photoId: string }> };

export const DELETE = withHandler("DELETE /api/photos/[photoId]", async (req: NextRequest, { params }: Context) => {
  const { photoId } = await params;

  // Look up the photo to get its storageKey
  const photo = await db.query.photos.findFirst({
    where: eq(photos.id, photoId),
  });

  if (!photo) {
    return apiNotFound("Photo not found");
  }

  // Delete storage files
  await deleteFile(photo.storageKey);
  if (photo.thumbnailKey) {
    await deleteFile(photo.thumbnailKey);
  }

  // Delete photo row from database
  await db.delete(photos).where(eq(photos.id, photoId)).run();

  logger.info("STORAGE", `Deleted photo ${photoId} (${photo.storageKey})`);
  return apiSuccess({ deletedPhotoId: photoId });
});

export const PATCH = withHandler("PATCH /api/photos/[photoId]", async (req: NextRequest, { params }: Context) => {
  const { photoId } = await params;

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
    return apiNotFound("Photo not found");
  }

  const body = await req.json();
  const updates: Partial<{ isSelected: boolean; imageHash: string | null }> = {};

  if ("isSelected" in body) {
    if (typeof body.isSelected !== "boolean") {
      return apiBadRequest("isSelected must be a boolean");
    }
    updates.isSelected = body.isSelected;
  }

  if ("imageHash" in body) {
    if (body.imageHash !== null && (typeof body.imageHash !== "string" || !/^[0-9a-f]{16}$/i.test(body.imageHash))) {
      return apiBadRequest("imageHash must be a 16-character hex string or null");
    }
    updates.imageHash = body.imageHash;
  }

  if (Object.keys(updates).length === 0) {
    return apiBadRequest("No supported fields provided");
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
      logger.warn("ACTIVITY", "Photo selection activity logging failed:", error);
    }
  }

  return apiSuccess();
});

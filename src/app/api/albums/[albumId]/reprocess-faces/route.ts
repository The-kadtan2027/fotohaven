import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ceremonies, photoFaces, photos } from "@/lib/schema";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ albumId: string }> }
) {
  try {
    const { albumId } = await params;

    const albumPhotos = db
      .select({ id: photos.id })
      .from(photos)
      .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
      .where(and(eq(ceremonies.albumId, albumId), eq(photos.isReturn, false)))
      .all();

    const photoIds = albumPhotos.map((photo) => photo.id);
    if (!photoIds.length) {
      return NextResponse.json({ resetCount: 0 });
    }

    db.transaction((tx) => {
      tx.delete(photoFaces).where(inArray(photoFaces.photoId, photoIds)).run();
      tx.update(photos).set({ faceProcessed: false }).where(inArray(photos.id, photoIds)).run();
    });

    return NextResponse.json({ resetCount: photoIds.length });
  } catch (error) {
    console.error("[POST /api/albums/:albumId/reprocess-faces]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

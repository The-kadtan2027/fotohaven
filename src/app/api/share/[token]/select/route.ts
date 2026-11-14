import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { albums, ceremonies, photos } from "@/lib/schema";
import { getOptionalGuestFromRequest, logActivity } from "@/lib/activity-log";

/**
 * Token-scoped batch selection for the share page.
 * Replaces N per-photo PATCH requests when a client selects/clears a ceremony.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const album = await db.query.albums.findFirst({
      where: eq(albums.shareToken, token),
      columns: { id: true, password: true, expiresAt: true },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    const body = (await req.json()) as {
      photoIds?: unknown;
      isSelected?: unknown;
      password?: unknown;
    };

    if (!Array.isArray(body.photoIds) || !body.photoIds.every((id) => typeof id === "string")) {
      return NextResponse.json({ error: "photoIds must be an array of strings" }, { status: 400 });
    }
    if (typeof body.isSelected !== "boolean") {
      return NextResponse.json({ error: "isSelected must be a boolean" }, { status: 400 });
    }

    if (album.password) {
      if (typeof body.password !== "string" || !(await bcrypt.compare(body.password, album.password))) {
        return NextResponse.json({ passwordRequired: true }, { status: 401 });
      }
    }

    const requestedIds = Array.from(new Set(body.photoIds as string[]));
    if (requestedIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const validPhotos = db
      .select({ id: photos.id })
      .from(photos)
      .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
      .where(and(eq(ceremonies.albumId, album.id), inArray(photos.id, requestedIds)))
      .all();
    const validIds = validPhotos.map((photo) => photo.id);

    if (validIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    db.update(photos)
      .set({ isSelected: body.isSelected })
      .where(inArray(photos.id, validIds))
      .run();

    try {
      const guest = await getOptionalGuestFromRequest(req, album.id);
      logActivity({
        albumId: album.id,
        guestId: guest?.id ?? null,
        eventType: body.isSelected ? "photo_selected" : "photo_deselected",
        payload: { count: validIds.length, batch: true },
      });
    } catch {
      // Activity logging must never fail the selection write.
    }

    return NextResponse.json({ ok: true, updated: validIds.length });
  } catch (error) {
    console.error("[POST /api/share/:token/select]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

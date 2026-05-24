import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUrl } from "@/lib/storage";
import { albums, photos as photosSchema } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; ceremonyId: string }> }
) {
  try {
    const { token, ceremonyId } = await params;

    const album = await db.query.albums.findFirst({
      where: eq(albums.shareToken, token),
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Password Protection Guard (must match the main share route)
    if (album.password) {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return NextResponse.json({ passwordRequired: true }, { status: 401 });
      }

      const providedPassword = authHeader.split("Bearer ")[1];
      const match = await bcrypt.compare(providedPassword, album.password);
      if (!match) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
    }

    // Check expiry
    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    const photos = await db.query.photos.findMany({
      where: eq(photosSchema.ceremonyId, ceremonyId),
      orderBy: [desc(photosSchema.createdAt)],
      with: {
        comments: true,
      },
    });

    // Generate presigned URLs (2hr TTL)
    const photosWithUrls = await Promise.all(
      photos.map(async (photo: any) => ({
        ...photo,
        url: await getPresignedUrl(photo.thumbnailKey || photo.storageKey, 7200),
        originalUrl: await getPresignedUrl(photo.storageKey, 7200),
      }))
    );

    return NextResponse.json(photosWithUrls);
  } catch (error) {
    console.error("[GET_CEREMONY_PHOTOS]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

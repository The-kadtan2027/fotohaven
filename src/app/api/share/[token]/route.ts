import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUrl } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;

    const album = await db.album.findUnique({
      where: { shareToken: token },
      include: {
        ceremonies: {
          orderBy: { order: "asc" },
          include: {
            photos: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Check expiry
    if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
      return NextResponse.json({ error: "This link has expired" }, { status: 410 });
    }

    // Strip password hash if any
    const { password: _password, ...safeAlbum } = album;

    // Generate presigned URLs for all photos (2hr TTL per spec)
    const albumWithUrls = {
      ...safeAlbum,
      ceremonies: await Promise.all(
        safeAlbum.ceremonies.map(async (ceremony) => ({
          ...ceremony,
          photos: await Promise.all(
            ceremony.photos.map(async (photo) => ({
              ...photo,
              url: await getPresignedUrl(photo.storageKey, 7200),
            }))
          ),
        }))
      ),
    };

    return NextResponse.json(albumWithUrls);
  } catch (error) {
    console.error("[GET_SHARE_ALBUM]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

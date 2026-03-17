import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUrl } from "@/lib/storage";

export async function GET(
  request: NextRequest,
  { params }: { params: { albumId: string } }
) {
  try {
    const { albumId } = params;

    const album = await db.album.findUnique({
      where: { id: albumId },
      include: {
        ceremonies: {
          orderBy: { order: 'asc' },
          include: {
            photos: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    // Generate presigned URLs for all photos
    const albumWithUrls = {
      ...album,
      ceremonies: await Promise.all(
        album.ceremonies.map(async (ceremony) => ({
          ...ceremony,
          photos: await Promise.all(
            ceremony.photos.map(async (photo) => ({
              ...photo,
              url: await getPresignedUrl(photo.storageKey),
            }))
          ),
        }))
      ),
    };

    return NextResponse.json(albumWithUrls);
  } catch (error) {
    console.error("[GET_ALBUM]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

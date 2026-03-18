import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUrl } from "@/lib/storage";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ albumId: string }> }
) {
  try {
    const { albumId } = await params;

    const album = await db.query.albums.findFirst({
      where: eq(albums.id, albumId),
      with: {
        ceremonies: {
          orderBy: (c, { asc }) => [asc(c.order)],
          with: {
            photos: {
              orderBy: (p, { desc }) => [desc(p.createdAt)],
              with: {
                comments: true,
              },
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
        album.ceremonies.map(async (ceremony: any) => ({
          ...ceremony,
          photos: await Promise.all(
            ceremony.photos.map(async (photo: any) => ({
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

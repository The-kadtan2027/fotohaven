import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPresignedUrl } from "@/lib/storage";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { sendViewNotification } from "@/lib/email";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const album = await db.query.albums.findFirst({
      where: eq(albums.shareToken, token),
      with: {
        ceremonies: {
          orderBy: (c: any, { asc }: any) => [asc(c.order)],
          with: {
            photos: {
              orderBy: (p: any, { desc }: any) => [desc(p.createdAt)],
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

    // Password Protection Guard
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

    // Trigger First View Notification
    if (album.notifyEmail && !album.firstViewedAt) {
      try {
        // Update first viewed status immediately
        db.update(albums)
          .set({ firstViewedAt: new Date() })
          .where(eq(albums.id, album.id))
          .run();

        // Send email (non-blocking)
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
        sendViewNotification(
          album.title,
          album.notifyEmail,
          `${baseUrl}/share/${token}`
        );
      } catch (err) {
        console.error("[NOTIFY_VIEW_ERROR]", err);
      }
    }

    // Strip password hash if any
    const { password: _password, ...safeAlbum } = album;

    // Generate presigned URLs for all photos (2hr TTL per spec)
    const albumWithUrls = {
      ...safeAlbum,
      ceremonies: await Promise.all(
        safeAlbum.ceremonies.map(async (ceremony: any) => ({
          ...ceremony,
          photos: await Promise.all(
            ceremony.photos.map(async (photo: any) => ({
              ...photo,
              url: await getPresignedUrl(photo.thumbnailKey || photo.storageKey, 7200),
              originalUrl: await getPresignedUrl(photo.storageKey, 7200),
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

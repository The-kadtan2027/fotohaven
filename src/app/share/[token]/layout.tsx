// src/app/share/[token]/layout.tsx
// Server Component — exports generateMetadata for OG/WhatsApp previews.
// The child page.tsx remains a "use client" component; this layout wraps it.

import type { Metadata } from "next";
import { db } from "@/lib/db";
import { albums, ceremonies, photos } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getPresignedUrl } from "@/lib/storage";

type Props = {
  params: Promise<{ token: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;

  try {
    const album = db
      .select({
        id: albums.id,
        title: albums.title,
        clientName: albums.clientName,
        password: albums.password,
      })
      .from(albums)
      .where(eq(albums.shareToken, token))
      .get();

    if (!album) {
      return {
        title: "FotoHaven — Photo Album",
        description: "View and download your event photos.",
      };
    }

    // Don't expose photo data (or count) for password-protected albums
    if (album.password) {
      return {
        title: `${album.title} — FotoHaven`,
        description: `${album.clientName} has shared a private photo album with you.`,
        openGraph: {
          title: `${album.title} — FotoHaven`,
          description: `${album.clientName} has shared a private photo album with you.`,
          type: "website",
        },
      };
    }

    // Count photos and ceremonies for the description
    const albumCeremonies = db
      .select({ id: ceremonies.id, name: ceremonies.name })
      .from(ceremonies)
      .where(eq(ceremonies.albumId, album.id))
      .all();

    const ceremonyCount = albumCeremonies.length;

    // One query: all original photos across all ceremonies (for count + first OG image)
    const allPhotos = db
      .select({ id: photos.id, thumbnailKey: photos.thumbnailKey, storageKey: photos.storageKey })
      .from(photos)
      .innerJoin(ceremonies, eq(photos.ceremonyId, ceremonies.id))
      .where(and(eq(ceremonies.albumId, album.id), eq(photos.isReturn, false)))
      .all();

    const photoCount = allPhotos.length;

    const description = [
      `Shared by ${album.clientName}`,
      photoCount > 0 ? `${photoCount} photos` : null,
      ceremonyCount > 1 ? `${ceremonyCount} ceremonies` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    // Use first photo of first ceremony as OG image
    let ogImageUrl: string | undefined;
    if (allPhotos.length > 0) {
      const firstPhoto = allPhotos[0];
      try {
        ogImageUrl = await getPresignedUrl(firstPhoto.thumbnailKey || firstPhoto.storageKey, 86400);
      } catch {
        // OG image is optional — continue without it
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://fotohaven.app";
    const shareUrl = `${appUrl}/share/${token}`;

    return {
      title: `${album.title} — FotoHaven`,
      description,
      openGraph: {
        title: `${album.title} — FotoHaven`,
        description,
        url: shareUrl,
        siteName: "FotoHaven",
        type: "website",
        ...(ogImageUrl
          ? {
              images: [
                {
                  url: ogImageUrl,
                  width: 800,
                  height: 600,
                  alt: `${album.title} photo preview`,
                },
              ],
            }
          : {}),
      },
      twitter: {
        card: ogImageUrl ? "summary_large_image" : "summary",
        title: `${album.title} — FotoHaven`,
        description,
        ...(ogImageUrl ? { images: [ogImageUrl] } : {}),
      },
    };
  } catch (err) {
    console.error("[OG_METADATA]", err);
    return {
      title: "FotoHaven — Photo Album",
      description: "View and download your event photos.",
    };
  }
}

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

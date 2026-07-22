import { ReactNode } from "react";
import { Metadata } from "next";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getPresignedUrl } from "@/lib/storage";

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;

  // Resolve base URL
  const headersList = await headers();
  const host = headersList.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${protocol}://${host}`;

  const album = await db.query.albums.findFirst({
    where: eq(albums.shareToken, token),
    with: {
      ceremonies: {
        orderBy: (c, { asc }) => [asc(c.order)],
        with: {
          photos: {
            orderBy: (p, { asc }) => [asc(p.createdAt)],
          },
        },
      },
    },
  });

  if (!album) {
    return {
      title: "Album Not Found | FotoHaven",
      description: "The requested album does not exist.",
      metadataBase: new URL(baseUrl),
    };
  }

  if (album.expiresAt && new Date(album.expiresAt) < new Date()) {
    return {
      title: "Expired Gallery | FotoHaven",
      description: "This photo gallery link has expired.",
      metadataBase: new URL(baseUrl),
    };
  }

  // Count total non-return original photos and ceremonies
  let totalPhotos = 0;
  let firstPhotoKey: string | null = null;

  for (const ceremony of album.ceremonies) {
    for (const photo of ceremony.photos) {
      if (!photo.isReturn) {
        totalPhotos++;
        if (!firstPhotoKey) {
          firstPhotoKey = photo.thumbnailKey || photo.storageKey;
        }
      }
    }
  }

  const ceremonyCount = album.ceremonies.length;
  const isProtected = Boolean(album.password);

  const title = isProtected
    ? `${album.title} (Protected) | FotoHaven`
    : `${album.title} | FotoHaven`;

  const description = isProtected
    ? `Password-protected photo gallery by ${album.clientName}`
    : `Photo gallery by ${album.clientName} · ${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} across ${ceremonyCount} ceremon${ceremonyCount === 1 ? "y" : "ies"}`;

  // Image handling
  let imageUrl = `${baseUrl}/icons/icon-512.png`; // default fallback
  if (!isProtected && firstPhotoKey) {
    const photoPath = await getPresignedUrl(firstPhotoKey);
    imageUrl = photoPath.startsWith("http") ? photoPath : `${baseUrl}${photoPath}`;
  }

  const shareUrl = `${baseUrl}/share/${token}`;

  return {
    title,
    description,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title,
      description,
      url: shareUrl,
      siteName: "FotoHaven",
      type: "website",
      images: [
        {
          url: imageUrl,
          alt: album.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function ShareLayout({ children }: LayoutProps) {
  return <>{children}</>;
}

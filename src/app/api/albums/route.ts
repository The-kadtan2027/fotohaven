// src/app/api/albums/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CreateAlbumPayload } from "@/types";
import { v4 as uuidv4 } from "uuid";

// POST /api/albums — create a new album with ceremony folders
export async function POST(req: NextRequest) {
  try {
    const body: CreateAlbumPayload = await req.json();

    if (!body.title || !body.clientName || !body.ceremonies?.length) {
      return NextResponse.json(
        { error: "title, clientName, and at least one ceremony are required" },
        { status: 400 }
      );
    }

    // Generate a short, URL-safe share token
    const shareToken = uuidv4().replace(/-/g, "").slice(0, 16);

    const album = await db.album.create({
      data: {
        title: body.title,
        clientName: body.clientName,
        shareToken,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        ceremonies: {
          create: body.ceremonies.map((name, index) => ({
            name,
            order: index,
          })),
        },
      },
      include: {
        ceremonies: {
          orderBy: { order: "asc" },
        },
      },
    });

    return NextResponse.json(album, { status: 201 });
  } catch (err) {
    console.error("[POST /api/albums]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/albums — list all albums (client dashboard)
export async function GET() {
  try {
    const albums = await db.album.findMany({
      include: {
        ceremonies: {
          include: {
            _count: { select: { photos: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const enriched = albums.map((album) => ({
      ...album,
      totalPhotos: album.ceremonies.reduce(
        (sum, c) => sum + c._count.photos,
        0
      ),
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[GET /api/albums]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

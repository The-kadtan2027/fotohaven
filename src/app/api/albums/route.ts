// src/app/api/albums/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CreateAlbumPayload } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { albums, ceremonies } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import bcrypt from "bcryptjs";

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
    const albumId = uuidv4();

    // Hash password if provided
    let hashedPassword = null;
    if (body.password) {
      hashedPassword = await bcrypt.hash(body.password, 10);
    }

    const createdAlbum = db.transaction((tx) => {
      tx.insert(albums).values({
        id: albumId,
        title: body.title,
        clientName: body.clientName,
        shareToken,
        password: hashedPassword,
        notifyEmail: body.notifyEmail,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).run();

      for (let i = 0; i < body.ceremonies.length; i++) {
        tx.insert(ceremonies).values({
          id: uuidv4(),
          name: body.ceremonies[i],
          albumId: albumId,
          order: i,
          createdAt: new Date(),
        }).run();
      }

      // Use synchronous core API inside better-sqlite3 transaction
      const albumData = tx.select().from(albums).where(eq(albums.id, albumId)).get();
      const ceremoniesData = tx.select().from(ceremonies).where(eq(ceremonies.albumId, albumId)).orderBy(asc(ceremonies.order)).all();
      
      return { ...albumData, ceremonies: ceremoniesData };
    });

    return NextResponse.json(createdAlbum, { status: 201 });
  } catch (err) {
    console.error("[POST /api/albums]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/albums — list all albums (client dashboard)
export async function GET() {
  try {
    const allAlbums = await db.query.albums.findMany({
      with: {
        ceremonies: {
          with: { photos: true },
          orderBy: (c, { asc }) => [asc(c.order)],
        },
      },
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    });

    const enriched = allAlbums.map((album) => ({
      ...album,
      // Since Drizzle with better-sqlite doesn't have a direct _count equivalent returning numbers elegantly
      // in nested relations without complex subqueries, we just fetch photos and count array length.
      totalPhotos: album.ceremonies.reduce(
        (sum, c) => sum + c.photos.length,
        0
      ),
    }));

    return NextResponse.json(enriched);
  } catch (err) {
    console.error("[GET /api/albums]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


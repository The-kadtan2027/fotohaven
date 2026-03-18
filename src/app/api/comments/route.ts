import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comments } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

// POST /api/comments — Create a new comment
export async function POST(req: NextRequest) {
  try {
    const { photoId, body, author } = await req.json();

    if (!photoId || !body || !author) {
      return NextResponse.json(
        { error: "photoId, body, and author are required" },
        { status: 400 }
      );
    }

    const commentId = uuidv4();
    
    // Insert comment using synchronous Drizzle-over-better-sqlite API
    db.insert(comments).values({
      id: commentId,
      body,
      author,
      photoId,
      createdAt: new Date(),
    }).run();

    // Fetch the created comment to return it (Relational queries are async)
    const newComment = await db.query.comments.findFirst({
      where: eq(comments.id, commentId),
    });

    return NextResponse.json(newComment, { status: 201 });
  } catch (err) {
    console.error("[POST /api/comments]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/comments?photoId=uuid — Get comments for a photo
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const photoId = searchParams.get("photoId");

    if (!photoId) {
      return NextResponse.json({ error: "photoId query param required" }, { status: 400 });
    }

    const photoComments = await db.query.comments.findMany({
      where: eq(comments.photoId, photoId),
      orderBy: [desc(comments.createdAt)],
    });

    return NextResponse.json(photoComments);
  } catch (err) {
    console.error("[GET /api/comments]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

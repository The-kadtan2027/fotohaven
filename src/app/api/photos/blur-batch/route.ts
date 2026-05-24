import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { photos } from "@/lib/schema";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const photoIds = Array.isArray(body.photoIds) ? body.photoIds.filter((value: unknown): value is string => typeof value === "string") : [];
    const isBlurred = body.isBlurred;

    if (photoIds.length === 0) {
      return NextResponse.json({ error: "photoIds must be a non-empty string array" }, { status: 400 });
    }

    if (typeof isBlurred !== "boolean") {
      return NextResponse.json({ error: "isBlurred must be a boolean" }, { status: 400 });
    }

    await db.update(photos).set({ isBlurred }).where(inArray(photos.id, photoIds)).run();

    return NextResponse.json({ ok: true, updatedCount: photoIds.length });
  } catch (error) {
    console.error("[POST /api/photos/blur-batch]", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

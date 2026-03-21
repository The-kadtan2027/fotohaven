import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ceremonies } from "@/lib/schema";
import { v4 as uuidv4 } from "uuid";
import { eq, desc } from "drizzle-orm";

// POST /api/ceremonies
// Creates a new ceremony (folder) within an album
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, albumId } = body;

    if (!name || !albumId) {
      return NextResponse.json({ error: "Missing name or albumId" }, { status: 400 });
    }

    // Determine the order for the new ceremony (place it at the end)
    const lastCeremony = await db.query.ceremonies.findFirst({
      where: eq(ceremonies.albumId, albumId),
      orderBy: [desc(ceremonies.order)],
    });

    const newOrder = lastCeremony ? lastCeremony.order + 1 : 0;

    const [created] = await db
      .insert(ceremonies)
      .values({
        id: uuidv4(),
        name,
        albumId,
        order: newOrder,
        createdAt: new Date(),
      })
      .returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("[POST /api/ceremonies]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

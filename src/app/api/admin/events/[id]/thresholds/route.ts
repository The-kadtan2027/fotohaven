import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { albums } from "@/lib/schema";

type ThresholdBody = {
  high_threshold?: number;
  low_threshold?: number;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as ThresholdBody;
    const high = body.high_threshold;
    const low = body.low_threshold;

    if (high !== undefined && (typeof high !== "number" || high < 0.1 || high > 1.0)) {
      return NextResponse.json(
        { error: "high_threshold must be between 0.1 and 1.0" },
        { status: 400 }
      );
    }

    if (low !== undefined && (typeof low !== "number" || low < 0.1 || low > 1.0)) {
      return NextResponse.json(
        { error: "low_threshold must be between 0.1 and 1.0" },
        { status: 400 }
      );
    }

    const nextHigh = high;
    const nextLow = low;
    if (nextHigh !== undefined && nextLow !== undefined && nextLow >= nextHigh) {
      return NextResponse.json(
        { error: "low_threshold must be less than high_threshold" },
        { status: 400 }
      );
    }

    const update: Partial<typeof albums.$inferInsert> = {};
    if (nextHigh !== undefined) update.highThreshold = nextHigh;
    if (nextLow !== undefined) update.lowThreshold = nextLow;

    if (!Object.keys(update).length) {
      return NextResponse.json({ error: "No valid threshold fields provided" }, { status: 400 });
    }

    await db
      .update(albums)
      .set({
        ...update,
        updatedAt: new Date(),
      })
      .where(eq(albums.id, id))
      .run();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/admin/events/:id/thresholds]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

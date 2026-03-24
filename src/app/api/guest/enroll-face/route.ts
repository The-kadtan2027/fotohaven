import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { guests } from "@/lib/schema";
import { getGuestCookieName, verifyGuestSession } from "@/lib/guest-auth";

type EnrollFaceBody = {
  descriptor?: number[];
};

function isDescriptor(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 128 && value.every((n) => typeof n === "number");
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get(getGuestCookieName())?.value;
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const payload = await verifyGuestSession(session);
    const guest = db
      .select()
      .from(guests)
      .where(and(eq(guests.id, payload.sub), eq(guests.albumId, payload.albumId)))
      .get();

    if (!guest || !guest.sessionToken || guest.sessionToken !== payload.st) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await request.json()) as EnrollFaceBody;
    if (!isDescriptor(body.descriptor)) {
      return NextResponse.json(
        { error: "descriptor must be an array of 128 numbers" },
        { status: 400 }
      );
    }

    db.update(guests)
      .set({
        faceDescriptor: JSON.stringify(Array.from(body.descriptor)),
      })
      .where(eq(guests.id, guest.id))
      .run();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/guest/enroll-face]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

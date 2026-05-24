import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose/jwt/verify";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { photoFaces, photos } from "@/lib/schema";

type FacePayload = {
  descriptor: number[];
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

function isValidFace(face: any): face is FacePayload {
  return (
    face &&
    Array.isArray(face.descriptor) &&
    face.descriptor.every((n: unknown) => typeof n === "number") &&
    face.boundingBox &&
    typeof face.boundingBox.x === "number" &&
    typeof face.boundingBox.y === "number" &&
    typeof face.boundingBox.width === "number" &&
    typeof face.boundingBox.height === "number"
  );
}

async function hasValidSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");
  if (!sessionCookie?.value) return false;

  const secret = process.env.JWT_SECRET;
  if (!secret) return false;

  try {
    const encodedSecret = new TextEncoder().encode(secret);
    await jwtVerify(sessionCookie.value, encodedSecret);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  try {
    const isAuthed = await hasValidSession();
    if (!isAuthed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { photoId } = await params;
    const photo = db
      .select({ id: photos.id })
      .from(photos)
      .where(eq(photos.id, photoId))
      .get();

    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }

    const body = await req.json();
    const faces = body?.faces;

    if (!Array.isArray(faces) || !faces.every(isValidFace)) {
      return NextResponse.json(
        { error: "Invalid faces payload" },
        { status: 400 }
      );
    }

    db.transaction((tx) => {
      tx.delete(photoFaces).where(eq(photoFaces.photoId, photoId)).run();

      for (const face of faces) {
        tx.insert(photoFaces)
          .values({
            id: uuidv4(),
            photoId,
            descriptor: JSON.stringify(face.descriptor),
            boundingBox: JSON.stringify(face.boundingBox),
          })
          .run();
      }

      tx.update(photos)
        .set({ faceProcessed: true })
        .where(eq(photos.id, photoId))
        .run();
    });

    return NextResponse.json({ saved: faces.length });
  } catch (error) {
    console.error("[POST /api/photos/:photoId/faces]", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}

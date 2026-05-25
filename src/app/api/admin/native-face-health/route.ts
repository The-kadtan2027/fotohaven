import { NextResponse } from "next/server";
import { FACE_RECOGNITION_CONFIG } from "@/lib/face-recognition-config";

export async function GET() {
  const baseUrl =
    FACE_RECOGNITION_CONFIG.usesLocalNativeService
      ? FACE_RECOGNITION_CONFIG.localNativeServiceUrl
      : FACE_RECOGNITION_CONFIG.usesRemotePythonService
        ? FACE_RECOGNITION_CONFIG.remoteServiceUrl
        : null;

  if (!baseUrl) {
    return NextResponse.json({ configured: false, healthy: false }, { status: 200 });
  }

  try {
    const response = await fetch(`${baseUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/native-face-health]", error);
    return NextResponse.json({ configured: true, healthy: false }, { status: 503 });
  }
}

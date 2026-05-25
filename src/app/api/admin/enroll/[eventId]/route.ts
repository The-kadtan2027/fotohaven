import { NextRequest, NextResponse } from "next/server";
import { FACE_CONFIG } from "@/lib/face-config";

function getFaceServiceUrl() {
  if (FACE_CONFIG.enrollmentBackend === "remote_python" && FACE_CONFIG.remoteServiceUrl) {
    return FACE_CONFIG.remoteServiceUrl;
  }
  if (FACE_CONFIG.enrollmentBackend === "local_native_http" && FACE_CONFIG.localNativeServiceUrl) {
    return FACE_CONFIG.localNativeServiceUrl;
  }
  return null;
}

async function proxyJson(
  input: string,
  init?: RequestInit,
  fallbackError = "Face service unavailable"
) {
  if (!input) {
    return NextResponse.json(
      { error: "Configured face extraction service is not available." },
      { status: 501 }
    );
  }
  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
    });
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
    });
  } catch (error) {
    console.error(`[admin enroll proxy] ${input}`, error);
    return NextResponse.json({ error: fallbackError }, { status: 503 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const faceService = getFaceServiceUrl();
  return proxyJson(
    faceService ? `${faceService}/enroll` : "",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId }),
      signal: AbortSignal.timeout(5_000),
    }
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  const faceService = getFaceServiceUrl();
  return proxyJson(
    faceService ? `${faceService}/enroll/status/${eventId}` : "",
    {
      signal: AbortSignal.timeout(3_000),
    }
  );
}

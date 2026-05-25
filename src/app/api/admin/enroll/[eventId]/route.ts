import { NextRequest, NextResponse } from "next/server";

const FACE_SERVICE = "http://127.0.0.1:5001";

async function proxyJson(
  input: string,
  init?: RequestInit,
  fallbackError = "Face service unavailable"
) {
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
  return proxyJson(
    `${FACE_SERVICE}/enroll`,
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
  return proxyJson(
    `${FACE_SERVICE}/enroll/status/${eventId}`,
    {
      signal: AbortSignal.timeout(3_000),
    }
  );
}

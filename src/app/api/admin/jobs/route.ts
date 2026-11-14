import { NextResponse } from "next/server";
import { getQueueMetrics, retryFailedJobs, clearCompletedJobs } from "@/lib/job-runner";

export async function GET() {
  try {
    const data = getQueueMetrics();
    return NextResponse.json(data);
  } catch (err) {
    console.error("[GET /api/admin/jobs]", err);
    return NextResponse.json({ error: "Failed to fetch job queue stats" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action;

    if (action === "retry_failed") {
      retryFailedJobs();
      return NextResponse.json({ ok: true, message: "Retrying all failed jobs" });
    }

    if (action === "clear_completed") {
      clearCompletedJobs();
      return NextResponse.json({ ok: true, message: "Cleared all completed jobs" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/admin/jobs]", err);
    return NextResponse.json({ error: "Failed to execute job action" }, { status: 500 });
  }
}

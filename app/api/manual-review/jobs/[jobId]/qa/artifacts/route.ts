import { NextResponse } from "next/server";

import {
  isManualReviewEnabled,
  saveManualQaPageArtifacts,
  type ManualQaPageArtifactPayload,
} from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json({ success: false, message: "manual review is disabled" }, { status: 404 });
  }

  try {
    const { jobId } = await params;
    const payload = (await request.json()) as ManualQaPageArtifactPayload;
    if (!Number.isInteger(payload?.pageIndex) || payload.pageIndex <= 0) {
      return NextResponse.json({ success: false, message: "pageIndex is required" }, { status: 400 });
    }

    const result = await saveManualQaPageArtifacts(jobId, payload);
    return NextResponse.json({ success: true, message: "qa artifacts saved", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "qa artifact save failed";
    const status = /ENOENT|not found|invalid/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

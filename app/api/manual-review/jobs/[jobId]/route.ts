import { NextResponse } from "next/server";

import { getManualReviewJobResponse, isManualReviewEnabled } from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json({ success: false, message: "manual review is disabled" }, { status: 404 });
  }

  try {
    const { jobId } = await params;
    const data = await getManualReviewJobResponse(jobId);
    return NextResponse.json({
      success: true,
      message: "ok",
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "not found";
    const status = /ENOENT|not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

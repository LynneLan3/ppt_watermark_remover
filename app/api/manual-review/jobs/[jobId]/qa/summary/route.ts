import { NextResponse } from "next/server";

import {
  buildAndWriteManualQaSummary,
  isManualReviewEnabled,
  type ManualQaPageReviewPayload,
} from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

type Payload = {
  pdfName: string;
  algorithmProfile: string;
  pageReviews: ManualQaPageReviewPayload[];
};

export async function POST(request: Request, { params }: Params) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json({ success: false, message: "manual review is disabled" }, { status: 404 });
  }

  try {
    const { jobId } = await params;
    const payload = (await request.json()) as Payload;
    if (!payload?.pdfName || !Array.isArray(payload.pageReviews)) {
      return NextResponse.json(
        { success: false, message: "pdfName and pageReviews are required" },
        { status: 400 },
      );
    }

    const result = await buildAndWriteManualQaSummary({
      jobId,
      pdfName: payload.pdfName,
      algorithmProfile: payload.algorithmProfile,
      pageReviews: payload.pageReviews,
    });

    return NextResponse.json({
      success: true,
      message: "qa summary exported",
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "qa summary export failed";
    const status = /ENOENT|not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

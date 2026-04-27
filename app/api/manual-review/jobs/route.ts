import { NextResponse } from "next/server";

import { validatePdfUpload } from "@/lib/server/api/upload-validation";
import {
  createManualReviewJob,
  getManualReviewJobResponse,
  isManualReviewEnabled,
} from "@/lib/server/manual-review/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isManualReviewEnabled()) {
    return NextResponse.json(
      {
        success: false,
        message: "manual review is disabled",
      },
      { status: 404 },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          message: "file is required",
        },
        { status: 400 },
      );
    }

    const validation = await validatePdfUpload(file);
    if (!validation.ok) {
      return NextResponse.json(
        {
          success: false,
          message: validation.message,
          code: validation.code,
        },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const job = await createManualReviewJob({
      originalFilename: file.name,
      fileBytes: bytes,
    });

    const data = await getManualReviewJobResponse(job.jobId);
    return NextResponse.json({
      success: true,
      message: "manual review job created",
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "internal error",
      },
      { status: 500 },
    );
  }
}

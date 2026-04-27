import { NextResponse } from "next/server";

import { jobError } from "@/lib/jobs/api";
import { analyzeJobV1Stateless, createStage2Job } from "@/lib/jobs/service";
import { saveUploadedSource } from "@/lib/jobs/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DIRECT_BETA_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "file is required.",
      });
    }

    if (file.size > MAX_DIRECT_BETA_BYTES) {
      return jobError({
        httpStatus: 413,
        code: "validation_error",
        message: "Direct beta mode supports files up to 4MB.",
      });
    }

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return jobError({
        httpStatus: 400,
        code: "unsupported_format",
        message: "Only PDF uploads are supported.",
      });
    }

    const job = await createStage2Job();
    const uploaded = await saveUploadedSource({
      jobId: job.jobId,
      file,
    });

    const analyzed = await analyzeJobV1Stateless({
      jobId: job.jobId,
      sourcePathname: uploaded.sourcePathname,
      sourceBlobUrl: uploaded.sourceBlobUrl,
    });

    return NextResponse.json({
      success: true,
      code: "ok",
      message: "Direct beta upload-and-analyze completed.",
      job: analyzed.job ?? uploaded,
      data: {
        review: analyzed.review,
        sourcePathname: analyzed.sourcePathname,
        sourceBlobUrl: analyzed.sourceBlobUrl,
        analysisPath: analyzed.analysisPath,
        directBetaMode: true,
        maxBytes: MAX_DIRECT_BETA_BYTES,
      },
    });
  } catch (error) {
    return jobError({
      httpStatus: 500,
      code: "analyze_failed",
      message: error instanceof Error ? error.message : "Direct upload-and-analyze failed.",
    });
  }
}

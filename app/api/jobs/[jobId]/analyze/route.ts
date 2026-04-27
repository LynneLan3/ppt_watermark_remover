import { NextResponse } from "next/server";

import { analyzeJobV1Stateless } from "@/lib/jobs/service";
import { readJob } from "@/lib/jobs/repository";
import { SourcePdfNotFoundError, SourcePdfReadFailedError } from "@/lib/blob-storage/source-reader";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type AnalyzeRequest = {
  sourcePathname?: string;
  sourceBlobUrl?: string;
  fileName?: string;
  size?: number;
  contentType?: string;
};

export async function POST(request: Request, { params }: Params) {
  const startTime = Date.now();
  const { jobId } = await params;
  const body = (await request.json().catch(() => ({}))) as AnalyzeRequest;

  const hasBodySourcePathname = Boolean(body.sourcePathname);
  const hasBodySourceBlobUrl = Boolean(body.sourceBlobUrl);

  let job: Awaited<ReturnType<typeof readJob>> | null = null;
  try {
    job = await readJob(jobId);
  } catch {
    job = null;
  }

  let sourcePathname = body.sourcePathname;
  let sourceBlobUrl = body.sourceBlobUrl;

  if (!sourcePathname && job?.sourcePathname) {
    sourcePathname = job.sourcePathname;
  }
  if (!sourceBlobUrl && job?.sourceBlobUrl) {
    sourceBlobUrl = job.sourceBlobUrl;
  }

  const jobManifestExists = Boolean(job);
  const hasJobSourcePathname = Boolean(job?.sourcePathname);
  const hasJobSourceBlobUrl = Boolean(job?.sourceBlobUrl);

  if (!sourcePathname && !sourceBlobUrl) {
    if (!jobManifestExists && !hasBodySourcePathname && !hasBodySourceBlobUrl) {
      return NextResponse.json(
        {
          success: false,
          code: "job_not_found",
          jobId,
          hasBodySourcePathname,
          hasBodySourceBlobUrl,
          jobManifestExists,
          hasJobSourcePathname,
          hasJobSourceBlobUrl,
          sourcePdfExists: false,
          message: "Job not found, expired, or already deleted.",
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        code: "upload_not_finalized",
        jobId,
        hasBodySourcePathname,
        hasBodySourceBlobUrl,
        jobManifestExists,
        hasJobSourcePathname,
        hasJobSourceBlobUrl,
        sourcePdfExists: false,
        message: "Upload not finalized. Missing sourcePathname/sourceBlobUrl.",
      },
      { status: 409 },
    );
  }

  try {
    const result = await analyzeJobV1Stateless({
      jobId,
      sourcePathname,
      sourceBlobUrl,
    });

    return NextResponse.json({
      success: true,
      code: "ok",
      message: "Analyze v1 completed.",
      job: result.job ?? job ?? undefined,
      data: {
        review: result.review,
        analysisPath: result.analysisPath,
        sourcePathname: result.sourcePathname,
        sourceBlobUrl: result.sourceBlobUrl,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    console.error({
      level: "error",
      phase: "analyze_error",
      jobId,
      error: errorMessage,
      errorType: error?.constructor?.name,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    if (error instanceof SourcePdfNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          code: "source_pdf_not_found",
          jobId,
          hasBodySourcePathname,
          hasBodySourceBlobUrl,
          sourcePathname: sourcePathname ?? null,
          jobManifestExists,
          sourcePdfExists: false,
          message: "Source PDF blob not found.",
        },
        { status: 404 },
      );
    }

    if (error instanceof SourcePdfReadFailedError) {
      return NextResponse.json(
        {
          success: false,
          code: "source_pdf_read_failed",
          jobId,
          hasBodySourcePathname,
          hasBodySourceBlobUrl,
          sourcePathname: sourcePathname ?? null,
          jobManifestExists,
          sourcePdfExists: true,
          message: "Failed to read source PDF from private blob storage.",
        },
        { status: 500 },
      );
    }

    if (
      errorMessage.toLowerCase().includes("python analyze failed") ||
      errorMessage.toLowerCase().includes("extract page commands failed")
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "pdf_analyze_failed",
          jobId,
          hasBodySourcePathname,
          hasBodySourceBlobUrl,
          sourcePathname: sourcePathname ?? null,
          jobManifestExists,
          sourcePdfExists: true,
          message: "PDF analyze failed.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: "analyze_failed",
        jobId,
        hasBodySourcePathname,
        hasBodySourceBlobUrl,
        sourcePathname: sourcePathname ?? null,
        jobManifestExists,
        sourcePdfExists: Boolean(sourcePathname || sourceBlobUrl),
        message: "Analyze failed.",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { jobError, mapRepositoryError } from "@/lib/jobs/api";
import { processJob, processJobStateless } from "@/lib/jobs/service";
import { readJob } from "@/lib/jobs/repository";
import { SourcePdfNotFoundError, SourcePdfReadFailedError } from "@/lib/blob-storage/source-reader";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type ProcessRequest = {
  processMode?: "object_level_v2" | "raster_repair_v1";
  sourcePathname?: string;
  sourceBlobUrl?: string;
  analysisPath?: string;
  analysis?: Record<string, unknown>;
};

export async function POST(request: Request, { params }: Params) {
  const startTime = Date.now();
  const { jobId } = await params;
  const body = (await request.json().catch(() => ({}))) as ProcessRequest;

  const processMode =
    body.processMode === "object_level_v2" || body.processMode === "raster_repair_v1"
      ? body.processMode
      : undefined;

  const debugMode = process.env.NODE_ENV !== "production" || new URL(request.url).searchParams.get("debug") === "1";
  if (processMode === "object_level_v2" && !debugMode) {
    return jobError({
      httpStatus: 400,
      code: "validation_error",
      message: "object-level processing is only available in debug mode.",
    });
  }

  const hasBodySourcePathname = Boolean(body.sourcePathname);
  const hasBodySourceBlobUrl = Boolean(body.sourceBlobUrl);
  const canRunStateless = hasBodySourcePathname || hasBodySourceBlobUrl;

  try {
    if (!canRunStateless) {
      const job = await processJob(jobId, { processMode });
      return NextResponse.json({
        success: true,
        code: "ok",
        message: "Process completed. Output is ready for download.",
        job,
        data: {
          nextStep: `GET /api/jobs/${jobId}/download`,
        },
      });
    }

    let jobManifestExists = false;
    try {
      await readJob(jobId);
      jobManifestExists = true;
    } catch {
      jobManifestExists = false;
    }

    const result = await processJobStateless({
      jobId,
      processMode,
      sourcePathname: body.sourcePathname,
      sourceBlobUrl: body.sourceBlobUrl,
      analysisPath: body.analysisPath,
      analysis: body.analysis,
    });

    return NextResponse.json({
      success: true,
      code: "ok",
      message: "Process completed. Output is ready for download.",
      job: result.job ?? undefined,
      data: {
        nextStep: `GET /api/jobs/${jobId}/download`,
        processOutputPath: result.outputPath,
        processReportPath: result.reportPath,
        processOutputBlobUrl: result.outputBlobUrl,
        processReportBlobUrl: result.reportBlobUrl,
        jobManifestExists,
      },
    });
  } catch (error) {
    if (!canRunStateless) {
      const mapped = mapRepositoryError(error);
      return jobError({
        httpStatus: mapped.httpStatus,
        code: mapped.code === "internal_error" ? "process_failed" : mapped.code,
        message: mapped.message,
      });
    }

    let jobManifestExists = false;
    try {
      await readJob(jobId);
      jobManifestExists = true;
    } catch {
      jobManifestExists = false;
    }

    try {
      throw error;
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : "unknown";
      console.error({
        level: "error",
        phase: "process_error_stateless",
        jobId,
        error: fallbackMessage,
        errorType: fallbackError?.constructor?.name,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      if (fallbackError instanceof SourcePdfNotFoundError) {
        return NextResponse.json(
          {
            success: false,
            code: "source_pdf_not_found",
            jobId,
            hasBodySourcePathname,
            hasBodySourceBlobUrl,
            sourcePathname: body.sourcePathname ?? null,
            jobManifestExists,
            sourcePdfExists: false,
            message: "Source PDF blob not found.",
          },
          { status: 404 },
        );
      }

      if (fallbackError instanceof SourcePdfReadFailedError) {
        return NextResponse.json(
          {
            success: false,
            code: "source_pdf_read_failed",
            jobId,
            hasBodySourcePathname,
            hasBodySourceBlobUrl,
            sourcePathname: body.sourcePathname ?? null,
            jobManifestExists,
            sourcePdfExists: true,
            message: "Failed to read source PDF from private blob storage.",
          },
          { status: 500 },
        );
      }

      const mapped = mapRepositoryError(fallbackError);
      return jobError({
        httpStatus: mapped.httpStatus,
        code: mapped.code === "internal_error" ? "process_failed" : mapped.code,
        message: mapped.message,
      });
    }
  }
}

import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { analyzeJobV1 } from "@/lib/jobs/service";
import {
  JobNotFoundError,
  UploadNotFinalizedError,
  SourcePdfNotFoundError,
  SourcePdfReadFailedError,
  getStorageDiagnostics,
  readJob,
} from "@/lib/jobs/repository";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  const startTime = Date.now();
  let jobId: string | undefined;

  try {
    const { jobId: paramJobId } = await params;
    jobId = paramJobId;

    // Log request start
    console.log({
      level: "info",
      phase: "analyze_start",
      jobId,
      timestamp: new Date().toISOString(),
    });

    const result = await analyzeJobV1(jobId);

    // Log success
    console.log({
      level: "info",
      phase: "analyze_complete",
      jobId,
      status: result.job.status,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return jobOk(
      "Analyze v1 completed.",
      {
        review: result.review,
      },
      result.job,
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Log error with context
    console.error({
      level: "error",
      phase: "analyze_error",
      jobId,
      error: error instanceof Error ? error.message : "unknown error",
      errorType: error?.constructor?.name,
      durationMs,
      timestamp: new Date().toISOString(),
    });

    // Handle specific error types
    if (error instanceof JobNotFoundError) {
      const diagnostics = getStorageDiagnostics(error.jobId);
      return Response.json(
        {
          success: false,
          code: "job_not_found",
          jobId: error.jobId,
          storageBackend: diagnostics.storageBackend,
          hasBlobToken: diagnostics.hasBlobToken,
          expectedManifestPath: diagnostics.expectedManifestPath,
          message: "Job not found, expired, or already deleted.",
        },
        { status: 404 },
      );
    }

    if (error instanceof UploadNotFinalizedError) {
      // Fetch job for diagnostic info
      let diagnosticInfo: Record<string, unknown> = {};
      if (jobId) {
        try {
          const job = await readJob(jobId);
          diagnosticInfo = {
            jobId,
            status: job.status,
            hasSourceBlobUrl: Boolean(job.sourceBlobUrl),
            hasSourcePathname: Boolean(job.sourcePathname),
            sourcePathname: job.sourcePathname || null,
          };
        } catch {
          // Ignore diagnostic fetch errors
        }
      }
      return jobError({
        httpStatus: 409,
        code: "upload_not_finalized",
        message: `Upload not finalized for job: ${error.jobId}`,
        ...diagnosticInfo,
      });
    }

    if (error instanceof SourcePdfNotFoundError) {
      return Response.json(
        {
          success: false,
          code: "source_pdf_not_found",
          jobId: error.jobId,
          sourcePathname: error.pathname,
          message: `Source PDF not found: ${error.pathname}`,
        },
        { status: 404 },
      );
    }

    if (error instanceof SourcePdfReadFailedError) {
      return Response.json(
        {
          success: false,
          code: "source_pdf_read_failed",
          jobId: error.jobId,
          sourcePathname: error.pathname,
          message: `Failed to read source PDF: ${error.pathname}`,
        },
        { status: 500 },
      );
    }

    const mapped = mapRepositoryError(error);
    if (mapped.code === "job_not_found" && jobId) {
      const diagnostics = getStorageDiagnostics(jobId);
      return Response.json(
        {
          success: false,
          code: "job_not_found",
          jobId,
          storageBackend: diagnostics.storageBackend,
          hasBlobToken: diagnostics.hasBlobToken,
          expectedManifestPath: diagnostics.expectedManifestPath,
          message: "Job not found, expired, or already deleted.",
        },
        { status: 404 },
      );
    }
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code === "internal_error" ? "analysis_failed" : mapped.code,
      message: mapped.message,
    });
  }
}

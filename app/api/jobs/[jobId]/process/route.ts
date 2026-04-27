import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { processJob } from "@/lib/jobs/service";
import { JobNotFoundError, UploadNotFinalizedError } from "@/lib/jobs/repository";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type ProcessRequest = {
  processMode?: "object_level_v2" | "raster_repair_v1";
};

export async function POST(request: Request, { params }: Params) {
  const startTime = Date.now();
  let jobId: string | undefined;

  try {
    const { jobId: paramJobId } = await params;
    jobId = paramJobId;

    console.log({
      level: "info",
      phase: "process_start",
      jobId,
      timestamp: new Date().toISOString(),
    });

    const body = (await request.json().catch(() => ({}))) as ProcessRequest;
    const processMode =
      body.processMode === "object_level_v2" || body.processMode === "raster_repair_v1"
        ? body.processMode
        : undefined;
    const debugMode =
      process.env.NODE_ENV !== "production" || new URL(request.url).searchParams.get("debug") === "1";
    if (processMode === "object_level_v2" && !debugMode) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "object-level processing is only available in debug mode.",
      });
    }

    const job = await processJob(jobId, { processMode });

    console.log({
      level: "info",
      phase: "process_complete",
      jobId,
      status: job.status,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return jobOk(
      "Process completed. Output is ready for download.",
      {
        nextStep: `GET /api/jobs/${jobId}/download`,
      },
      job,
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;

    console.error({
      level: "error",
      phase: "process_error",
      jobId,
      error: error instanceof Error ? error.message : "unknown error",
      errorType: error?.constructor?.name,
      durationMs,
      timestamp: new Date().toISOString(),
    });

    // Handle specific error types
    if (error instanceof JobNotFoundError) {
      return jobError({
        httpStatus: 404,
        code: "job_not_found",
        message: `Job not found: ${error.jobId}`,
      });
    }

    if (error instanceof UploadNotFinalizedError) {
      return jobError({
        httpStatus: 409,
        code: "upload_not_finalized",
        message: `Upload not finalized for job: ${error.jobId}`,
      });
    }

    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code === "internal_error" ? "process_failed" : mapped.code,
      message: mapped.message,
    });
  }
}

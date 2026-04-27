import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { createStage2Job } from "@/lib/jobs/service";

export const runtime = "nodejs";

export async function POST() {
  const startTime = Date.now();

  try {
    console.log({
      level: "info",
      phase: "create_start",
      timestamp: new Date().toISOString(),
    });

    const job = await createStage2Job();

    console.log({
      level: "info",
      phase: "create_complete",
      jobId: job.jobId,
      status: job.status,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return jobOk(
      "Job created.",
      {
        jobId: job.jobId,
        nextStep: "POST /api/jobs/upload-token to get an upload token.",
      },
      job,
    );
  } catch (error) {
    console.error({
      level: "error",
      phase: "create_error",
      error: error instanceof Error ? error.message : "unknown error",
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

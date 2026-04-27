import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { createStage2Job } from "@/lib/jobs/service";

export const runtime = "nodejs";

export async function POST() {
  try {
    const job = await createStage2Job();
    return jobOk(
      "Job created.",
      {
        jobId: job.jobId,
        nextStep: "POST /api/jobs/upload-token to get an upload token.",
      },
      job,
    );
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

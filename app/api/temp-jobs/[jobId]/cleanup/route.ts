import { apiError, apiOk } from "@/lib/server/api/responses";
import { classifyApiError } from "@/lib/server/api/classify-error";
import { toInternalErrorMessage } from "@/lib/server/errors/classify";
import { cleanupSingleJob } from "@/lib/server/jobs/service";
import { readJobMetadata } from "@/lib/server/jobs/repository";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const job = await readJobMetadata(jobId);
    const outcome = await cleanupSingleJob(jobId);
    if (!outcome.success) {
      return apiError({
        httpStatus: 500,
        status: job.status,
        code: "cleanup_failed",
        message: outcome.message,
        job,
      });
    }
    return apiOk({
      status: job.status,
      message: "Cleanup completed.",
      job,
    });
  } catch (error) {
    const classified = classifyApiError(error);
    return apiError({
      httpStatus: classified.httpStatus,
      code: classified.code,
      message: classified.message || toInternalErrorMessage(error),
    });
  }
}

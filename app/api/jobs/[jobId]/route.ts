import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { getJobWithReview } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const result = await getJobWithReview(jobId);
    return jobOk(
      "Job status fetched.",
      {
        review: result.reviewPayload,
        processReport: result.processReport,
        imageSkippedSummary: result.imageSkippedSummary,
        replayPlan: result.replayPlan,
        suiteManifest: result.suiteManifest,
      },
      result.job,
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

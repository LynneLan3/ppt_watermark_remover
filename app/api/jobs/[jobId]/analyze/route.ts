import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { analyzeJobV1 } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const result = await analyzeJobV1(jobId);
    return jobOk(
      "Analyze v1 completed.",
      {
        review: result.review,
      },
      result.job,
    );
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code === "internal_error" ? "analysis_failed" : mapped.code,
      message: mapped.message,
    });
  }
}

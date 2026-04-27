import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { deleteStage2Job } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function POST(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    await deleteStage2Job(jobId);
    return jobOk("Job deleted.", { jobId });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

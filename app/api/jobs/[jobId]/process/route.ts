import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { processJob } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type ProcessRequest = {
  processMode?: "object_level_v2" | "raster_repair_v1";
};

export async function POST(request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
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
    return jobOk(
      "Process completed. Output is ready for download.",
      {
        nextStep: `GET /api/jobs/${jobId}/download`,
      },
      job,
    );
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code === "internal_error" ? "process_failed" : mapped.code,
      message: mapped.message,
    });
  }
}

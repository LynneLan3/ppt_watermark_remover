import { readFile } from "node:fs/promises";

import { jobError, mapRepositoryError } from "@/lib/jobs/api";
import { fileExists, readJob, resolvePaths } from "@/lib/jobs/repository";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const job = await readJob(jobId);
    if (job.status !== "ready_for_download" && job.status !== "downloaded") {
      throw new Error(`invalid state for preview: ${job.status}`);
    }

    const outputPath = job.processOutputPath ?? resolvePaths(jobId).processedPdfPath;
    if (!(await fileExists(outputPath))) {
      throw new Error("download unavailable");
    }

    const payload = await readFile(outputPath);
    const filename = `${jobId}.processed.pdf`;
    return new Response(payload, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

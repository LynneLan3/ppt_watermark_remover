import { readFile } from "node:fs/promises";

import { jobError, mapRepositoryError } from "@/lib/jobs/api";
import { prepareDownload } from "@/lib/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const result = await prepareDownload(jobId);
    const payload = await readFile(result.path);
    const filename = `${jobId}.processed.pdf`;
    return new Response(payload, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-job-status": result.job.status,
      },
    });
  } catch (error) {
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code:
        mapped.message.toLowerCase().includes("download unavailable")
          ? "download_unavailable"
          : mapped.code,
      message: mapped.message,
    });
  }
}

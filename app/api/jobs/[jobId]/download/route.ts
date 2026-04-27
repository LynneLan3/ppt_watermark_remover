import { readFile } from "node:fs/promises";
import { get } from "@vercel/blob";

import { jobError, mapRepositoryError } from "@/lib/jobs/api";
import { prepareDownload } from "@/lib/jobs/service";
import { isBlobStorageEnabled } from "@/lib/blob-storage/job-store";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  try {
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
    if (isBlobStorageEnabled()) {
      try {
        const blob = await get(`jobs/${jobId}/processed.pdf`, {
          access: "private",
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        if (blob?.stream) {
          const filename = `${jobId}.processed.pdf`;
          return new Response(blob.stream, {
            status: 200,
            headers: {
              "content-type": "application/pdf",
              "content-disposition": `attachment; filename="${filename}"`,
              "x-job-status": "ready_for_download",
            },
          });
        }
      } catch {
        // Ignore blob fallback errors and continue to mapped error response.
      }
    }
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

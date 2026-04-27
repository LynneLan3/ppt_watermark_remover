import { readFile } from "node:fs/promises";
import { get } from "@vercel/blob";

import { jobError, mapRepositoryError } from "@/lib/jobs/api";
import { fileExists, readJob, resolvePaths } from "@/lib/jobs/repository";
import { isBlobStorageEnabled } from "@/lib/blob-storage/job-store";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  try {
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
              "content-disposition": `inline; filename="${filename}"`,
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
      code: mapped.code,
      message: mapped.message,
    });
  }
}

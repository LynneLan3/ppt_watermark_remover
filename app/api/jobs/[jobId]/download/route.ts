import { readFile } from "node:fs/promises";
import { get } from "@vercel/blob";

import { fileExists, readJob, resolvePaths } from "@/lib/jobs/repository";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { jobId } = await params;
  const url = new URL(request.url);
  const queryProcessedPathname = url.searchParams.get("processedPathname");

  const defaultProcessedPathname = `jobs/${jobId}/processed.pdf`;
  let candidatePathname: string | null = queryProcessedPathname;
  let legacyBlobUrl: string | null = null;
  let legacyLocalPath: string = resolvePaths(jobId).processedPdfPath;
  let statusHeader = "ready_for_download";

  try {
    const job = await readJob(jobId);
    statusHeader = job.status;
    const anyJob = job as Record<string, unknown>;
    candidatePathname =
      candidatePathname ||
      job.processedPathname ||
      (typeof anyJob.cleanedPdfPath === "string" ? anyJob.cleanedPdfPath : null) ||
      (typeof anyJob.outputPath === "string" ? anyJob.outputPath : null) ||
      (typeof anyJob.processedPdfPath === "string" ? anyJob.processedPdfPath : null) ||
      defaultProcessedPathname;
    legacyBlobUrl =
      (typeof anyJob.cleanedPdfUrl === "string" ? anyJob.cleanedPdfUrl : null) ||
      (typeof anyJob.outputUrl === "string" ? anyJob.outputUrl : null) ||
      (typeof anyJob.processedPdfUrl === "string" ? anyJob.processedPdfUrl : null) ||
      job.processedBlobUrl ||
      job.processOutputBlobUrl ||
      null;
    legacyLocalPath = job.processOutputPath || resolvePaths(jobId).processedPdfPath;
  } catch {
    candidatePathname = candidatePathname || defaultProcessedPathname;
  }

  try {
    const blob = await get(candidatePathname ?? defaultProcessedPathname, {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (blob?.stream) {
      return new Response(blob.stream, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${jobId}.processed.pdf"`,
          "x-job-status": statusHeader,
        },
      });
    }
  } catch {
    // Continue fallback chain.
  }

  if (legacyBlobUrl) {
    try {
      const blobByUrl = await get(legacyBlobUrl, {
        access: "private",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (blobByUrl?.stream) {
        return new Response(blobByUrl.stream, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${jobId}.processed.pdf"`,
            "x-job-status": statusHeader,
          },
        });
      }
    } catch {
      // Continue fallback chain.
    }
  }

  if (await fileExists(legacyLocalPath)) {
    const payload = await readFile(legacyLocalPath);
    return new Response(payload, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${jobId}.processed.pdf"`,
        "x-job-status": statusHeader,
      },
    });
  }

  return Response.json(
    {
      success: false,
      code: "processed_pdf_not_found",
      jobId,
      processedPathname: candidatePathname || defaultProcessedPathname,
      message: "Processed PDF not found.",
    },
    { status: 404 },
  );
}

import { NextResponse } from "next/server";
import { head } from "@vercel/blob";

import { fileExists, getStorageDiagnostics, readJob, resolvePaths, sourcePdfExists } from "@/lib/jobs/repository";
import { JobNotFoundError } from "@/lib/blob-storage/job-store";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const diagnostics = getStorageDiagnostics(jobId);

  try {
    const job = await readJob(jobId);
    const hasSourcePathname = !!job.sourcePathname;
    const sourcePdfExistsResult = hasSourcePathname ? await sourcePdfExists(jobId) : false;
    const processedPathname = job.processedPathname || `jobs/${jobId}/processed.pdf`;
    let processedPdfExists = false;
    let processedSize: number | null = job.processedSize ?? null;
    try {
      const info = await head(processedPathname, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      processedPdfExists = Boolean(info);
      if (info?.size && !processedSize) {
        processedSize = info.size;
      }
    } catch {
      const localProcessedPath = job.processOutputPath ?? resolvePaths(jobId).processedPdfPath;
      processedPdfExists = await fileExists(localProcessedPath);
    }
    const processedBlobUrlHost = job.processedBlobUrl
      ? new URL(job.processedBlobUrl).host
      : job.processOutputBlobUrl
        ? new URL(job.processOutputBlobUrl).host
        : null;

    return NextResponse.json({
      ok: true,
      jobId,
      storageBackend: diagnostics.storageBackend,
      hasBlobToken: diagnostics.hasBlobToken,
      expectedManifestPath: diagnostics.expectedManifestPath,
      jobManifestExists: true,
      sourcePdfExists: sourcePdfExistsResult,
      status: job.status,
      errorCode: job.failureCode || null,
      errorMessage: job.failureMessage || null,
      hasSourceBlobUrl: !!job.sourceBlobUrl,
      hasSourcePathname: hasSourcePathname,
      sourcePathname: job.sourcePathname || null,
      sourceBlobUrl: job.sourceBlobUrl ? `${job.sourceBlobUrl.substring(0, 50)}...` : null,
      sourceFilename: job.sourceFilename || null,
      sourceSize: job.sourceSize || null,
      sourceContentType: job.sourceContentType || null,
      processedPathname,
      processedBlobUrlHost,
      processedPdfExists,
      processedSize,
      processMode: job.processMode || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      expiresAt: job.expiresAt,
    });
  } catch (error) {
    if (error instanceof JobNotFoundError) {
      return NextResponse.json(
        {
          ok: false,
          code: "job_not_found",
          jobId: error.jobId,
          storageBackend: diagnostics.storageBackend,
          hasBlobToken: diagnostics.hasBlobToken,
          expectedManifestPath: diagnostics.expectedManifestPath,
          jobManifestExists: false,
          message: "Job not found, expired, or already deleted.",
        },
        { status: 404 },
      );
    }

    if (error instanceof Error && error.message === "STORAGE_NOT_CONFIGURED") {
      return NextResponse.json(
        {
          ok: false,
          code: "STORAGE_NOT_CONFIGURED",
          jobId,
          storageBackend: diagnostics.storageBackend,
          hasBlobToken: diagnostics.hasBlobToken,
          expectedManifestPath: diagnostics.expectedManifestPath,
          jobManifestExists: false,
          message: "Storage is not configured for this environment.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "internal_error",
        message: error instanceof Error ? error.message : "Internal error",
      },
      { status: 500 },
    );
  }
}

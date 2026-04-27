import { NextResponse } from "next/server";

import { getStorageDiagnostics, readJob } from "@/lib/jobs/repository";
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

    return NextResponse.json({
      ok: true,
      jobId,
      storageBackend: diagnostics.storageBackend,
      hasBlobToken: diagnostics.hasBlobToken,
      expectedManifestPath: diagnostics.expectedManifestPath,
      jobManifestExists: true,
      status: job.status,
      hasSourceBlobUrl: !!job.sourceBlobUrl,
      hasSourcePathname: !!job.sourcePathname,
      sourceBlobUrl: job.sourceBlobUrl ? `${job.sourceBlobUrl.substring(0, 50)}...` : null,
      sourcePathname: job.sourcePathname,
      sourceFilename: job.sourceFilename,
      sourceSize: job.sourceSize,
      sourceContentType: job.sourceContentType,
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

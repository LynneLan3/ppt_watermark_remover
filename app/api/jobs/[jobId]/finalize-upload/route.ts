import { NextResponse } from "next/server";

import { jobError, mapRepositoryError } from "@/lib/jobs/api";
import { getStorageDiagnostics, readJob, writeJobMetadata } from "@/lib/jobs/repository";
import { JobNotFoundError } from "@/lib/blob-storage/job-store";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

type FinalizeUploadRequest = {
  sourceBlobUrl?: string;
  url?: string;
  sourcePathname?: string;
  pathname?: string;
  fileName?: string;
  size?: number;
  contentType?: string;
};

export async function POST(request: Request, { params }: Params) {
  const startTime = Date.now();
  let jobId: string | undefined;

  try {
    const { jobId: paramJobId } = await params;
    jobId = paramJobId;
    const diagnostics = getStorageDiagnostics(jobId);

    console.log({
      level: "info",
      phase: "finalize_upload_start",
      jobId,
      timestamp: new Date().toISOString(),
    });

    const body = (await request.json().catch(() => ({}))) as FinalizeUploadRequest;

    // Read job
    const job = await readJob(jobId);

    // Get blob URL and pathname from request
    const sourceBlobUrl = body.sourceBlobUrl || body.url;
    const sourcePathname = body.sourcePathname || body.pathname;

    if (!sourceBlobUrl || !sourcePathname) {
      console.error({
        level: "error",
        phase: "finalize_upload_error",
        jobId,
        error: "Missing sourceBlobUrl or sourcePathname",
        body: JSON.stringify(body),
      });
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "Invalid upload result: sourceBlobUrl and sourcePathname are required.",
      });
    }

    // Update job manifest
    const updatedJob = {
      ...job,
      status: "uploaded" as const,
      sourceBlobUrl,
      sourcePathname,
      sourceFilename: body.fileName || job.sourceFilename,
      sourceSize: body.size,
      sourceContentType: body.contentType || "application/pdf",
      updatedAt: new Date().toISOString(),
    };

    await writeJobMetadata(updatedJob);
    const readBack = await readJob(jobId);
    const hasReadBackBlob = Boolean(readBack.sourceBlobUrl);
    const hasReadBackPathname = Boolean(readBack.sourcePathname);
    if (!hasReadBackBlob || !hasReadBackPathname || readBack.status !== "uploaded") {
      return jobError({
        httpStatus: 500,
        code: "FINALIZE_WRITE_FAILED",
        message: "Failed to verify finalized upload manifest write.",
      });
    }

    console.log({
      level: "info",
      phase: "finalize_upload_complete",
      jobId,
      status: updatedJob.status,
      hasSourceBlobUrl: !!updatedJob.sourceBlobUrl,
      hasSourcePathname: !!updatedJob.sourcePathname,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      code: "ok",
      message: "Upload finalized.",
      ok: true,
      jobId,
      status: "uploaded",
      hasSourceBlobUrl: true,
      hasSourcePathname: true,
      manifestPath: diagnostics.expectedManifestPath,
      data: {
        jobId,
        status: "uploaded",
        hasSourceBlobUrl: true,
        hasSourcePathname: true,
        manifestPath: diagnostics.expectedManifestPath,
      },
      job: readBack,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;

    console.error({
      level: "error",
      phase: "finalize_upload_error",
      jobId,
      error: error instanceof Error ? error.message : "unknown error",
      errorType: error?.constructor?.name,
      durationMs,
      timestamp: new Date().toISOString(),
    });

    if (error instanceof JobNotFoundError) {
      return jobError({
        httpStatus: 404,
        code: "job_not_found",
        message: "Job not found, expired, or already deleted.",
        job: undefined,
      });
    }

    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

import { NextResponse } from "next/server";

import { readJob } from "@/lib/jobs/repository";
import { JobNotFoundError } from "@/lib/blob-storage/job-store";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const job = await readJob(jobId);

    return NextResponse.json({
      ok: true,
      jobId,
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
          message: `Job not found: ${error.jobId}`,
        },
        { status: 404 },
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

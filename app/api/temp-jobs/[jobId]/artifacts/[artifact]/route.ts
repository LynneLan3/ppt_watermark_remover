import { NextResponse } from "next/server";

import { classifyApiError } from "@/lib/server/api/classify-error";
import { apiError } from "@/lib/server/api/responses";
import { toInternalErrorMessage } from "@/lib/server/errors/classify";
import { hasArtifact, readJobMetadata } from "@/lib/server/jobs/repository";
import { getJobArtifactPath } from "@/lib/server/python-runner/engine";
import { readArtifactBuffer, registerArtifactDownload } from "@/lib/server/jobs/service";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string; artifact: string }>;
};

type ArtifactKind = "analysis" | "cleaned" | "report";

export async function GET(_request: Request, { params }: Params) {
  try {
    const { jobId, artifact } = await params;
    if (!isArtifactKind(artifact)) {
      return apiError({
        httpStatus: 400,
        code: "validation_error",
        message: "unsupported artifact",
      });
    }

    const job = await readJobMetadata(jobId);
    const artifactPath = await getJobArtifactPath({
      jobId,
      artifact,
    });
    const exists = await hasArtifact(artifactPath);
    if (!exists) {
      return apiError({
        httpStatus: 404,
        status: job.status,
        code: "artifact_missing",
        message: "Requested artifact is missing or already deleted.",
        job,
      });
    }

    const buffer = await readArtifactBuffer({
      jobId,
      artifact,
    });
    const filename = artifactFileName(jobId, artifact);
    const contentType = artifactContentType(artifact);

    if (artifact === "cleaned" || artifact === "report") {
      const downloadOutcome = await registerArtifactDownload({
        jobId,
        artifact,
      });
      if (downloadOutcome.cleanupTriggered && !downloadOutcome.cleanupSucceeded) {
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "content-type": contentType,
            "content-disposition": `attachment; filename="${filename}"`,
            "x-cleanup-status": "failed",
            "x-cleanup-error-code": "cleanup_failed",
          },
        });
      }
    }

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filename}"`,
        "x-cleanup-policy": "delete_after_both_downloads_or_expiry",
      },
    });
  } catch (error) {
    const classified = classifyApiError(error);
    return apiError({
      httpStatus: classified.httpStatus,
      code: classified.code,
      message: classified.message || toInternalErrorMessage(error),
    });
  }
}

function isArtifactKind(value: string): value is ArtifactKind {
  return value === "analysis" || value === "cleaned" || value === "report";
}

function artifactContentType(artifact: ArtifactKind): string {
  if (artifact === "cleaned") {
    return "application/pdf";
  }
  return "application/json";
}

function artifactFileName(jobId: string, artifact: ArtifactKind): string {
  if (artifact === "cleaned") {
    return `${jobId}.cleaned.pdf`;
  }
  if (artifact === "analysis") {
    return `${jobId}.analysis.json`;
  }
  return `${jobId}.report.json`;
}

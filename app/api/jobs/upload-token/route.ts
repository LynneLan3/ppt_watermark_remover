import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { issueUploadToken } from "@/lib/jobs/service";

export const runtime = "nodejs";

// 增加 body size limit 以支持最大 50MB 上传
export const dynamic = "force-dynamic";
export const maxBodyLength = 50 * 1024 * 1024; // 50MB

type UploadTokenRequest = {
  jobId?: string;
};

export async function POST(request: Request) {
  return handleIssueToken(request, Date.now());
}

async function handleIssueToken(request: Request, startTime: number) {
  try {
    const body = (await request.json()) as UploadTokenRequest;

    console.log({
      level: "info",
      phase: "upload_token_start",
      jobId: body.jobId,
      timestamp: new Date().toISOString(),
    });

    if (!body.jobId) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "jobId is required.",
      });
    }

    const token = await issueUploadToken(body.jobId);

    console.log({
      level: "info",
      phase: "upload_token_complete",
      jobId: token.job.jobId,
      status: token.job.status,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return jobOk(
      "Upload token issued.",
      {
        jobId: token.job.jobId,
        uploadToken: token.uploadToken,
        uploadTokenExpiresAt: token.expiresAt,
        uploadEndpoint: "/api/jobs/upload-source",
      },
      token.job,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    console.error({
      level: "error",
      phase: "upload_token_error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    const mapped = mapRepositoryError(error);

    // Sanitize error message - don't expose internal details
    const lowerError = errorMessage.toLowerCase();
    let sanitizedMessage = mapped.message;
    if (
      lowerError.includes("vercel") ||
      lowerError.includes("blob") ||
      lowerError.includes("token") ||
      lowerError.includes("internal") ||
      lowerError.includes("path")
    ) {
      sanitizedMessage = "Failed to prepare upload. Please try again.";
    }

    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: sanitizedMessage,
    });
  }
}

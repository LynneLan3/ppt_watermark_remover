import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { issueUploadToken, uploadSourcePdf } from "@/lib/jobs/service";

export const runtime = "nodejs";

// 增加 body size limit 以支持最大 50MB 上传
export const dynamic = "force-dynamic";
export const maxBodyLength = 50 * 1024 * 1024; // 50MB

type UploadTokenRequest = {
  jobId?: string;
};

export async function POST(request: Request) {
  const startTime = Date.now();
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    return handleMultipartUpload(request, startTime);
  }
  return handleIssueToken(request, startTime);
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
        uploadEndpoint: "/api/jobs/upload-token",
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

async function handleMultipartUpload(request: Request, startTime: number) {
  try {
    const form = await request.formData();
    const jobId = form.get("jobId");
    const uploadToken = form.get("uploadToken");
    const file = form.get("file");

    console.log({
      level: "info",
      phase: "upload_start",
      jobId: typeof jobId === "string" ? jobId : undefined,
      timestamp: new Date().toISOString(),
    });

    if (typeof jobId !== "string" || typeof uploadToken !== "string" || !(file instanceof File)) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "multipart fields jobId, uploadToken, file are required.",
      });
    }

    const job = await uploadSourcePdf({
      jobId,
      uploadToken,
      file,
    });

    console.log({
      level: "info",
      phase: "upload_complete",
      jobId: job.jobId,
      status: job.status,
      sourceBlobUrl: job.sourceBlobUrl ? "exists" : "missing",
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return jobOk(
      "Source PDF uploaded.",
      {
        jobId: job.jobId,
        sourceFilename: job.sourceFilename,
        sourceBlobUrl: job.sourceBlobUrl,
        sourcePathname: job.sourcePathname,
        nextStep: `POST /api/jobs/${job.jobId}/finalize-upload`,
      },
      job,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown error";
    console.error({
      level: "error",
      phase: "upload_error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    // Check for Blob pathname conflict
    const lowerError = errorMessage.toLowerCase();
    if (
      lowerError.includes("blob already exists") ||
      lowerError.includes("this blob already exists") ||
      lowerError.includes("already exists")
    ) {
      return jobError({
        httpStatus: 409,
        code: "blob_path_conflict",
        message: "Temporary upload path already exists. Please try again.",
      });
    }

    const mapped = mapRepositoryError(error);
    const code =
      mapped.message.toLowerCase().includes("only pdf") ||
      mapped.message.toLowerCase().includes("uploaded pdf")
        ? "unsupported_format"
        : mapped.code;

    // Sanitize error message - don't expose internal details
    let sanitizedMessage = mapped.message;
    if (
      lowerError.includes("vercel") ||
      lowerError.includes("blob") ||
      lowerError.includes("token") ||
      lowerError.includes("internal")
    ) {
      sanitizedMessage = "Upload failed. Please try again.";
    }

    return jobError({
      httpStatus: mapped.httpStatus,
      code,
      message: sanitizedMessage,
    });
  }
}

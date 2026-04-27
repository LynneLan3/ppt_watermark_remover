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
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return handleMultipartUpload(request);
  }
  return handleIssueToken(request);
}

async function handleIssueToken(request: Request) {
  try {
    const body = (await request.json()) as UploadTokenRequest;
    if (!body.jobId) {
      return jobError({
        httpStatus: 400,
        code: "validation_error",
        message: "jobId is required.",
      });
    }
    const token = await issueUploadToken(body.jobId);
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
    const mapped = mapRepositoryError(error);
    return jobError({
      httpStatus: mapped.httpStatus,
      code: mapped.code,
      message: mapped.message,
    });
  }
}

async function handleMultipartUpload(request: Request) {
  try {
    const form = await request.formData();
    const jobId = form.get("jobId");
    const uploadToken = form.get("uploadToken");
    const file = form.get("file");

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
    return jobOk(
      "Source PDF uploaded.",
      {
        jobId: job.jobId,
        sourceFilename: job.sourceFilename,
        nextStep: `POST /api/jobs/${job.jobId}/analyze`,
      },
      job,
    );
  } catch (error) {
    const mapped = mapRepositoryError(error);
    const code =
      mapped.message.toLowerCase().includes("only pdf") ||
      mapped.message.toLowerCase().includes("uploaded pdf")
        ? "unsupported_format"
        : mapped.code;
    return jobError({
      httpStatus: mapped.httpStatus,
      code,
      message: mapped.message,
    });
  }
}

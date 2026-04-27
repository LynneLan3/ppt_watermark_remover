import { jobError, jobOk, mapRepositoryError } from "@/lib/jobs/api";
import { uploadSourcePdf } from "@/lib/jobs/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxBodyLength = 50 * 1024 * 1024;

export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const form = await request.formData();
    const jobId = form.get("jobId");
    const uploadToken = form.get("uploadToken");
    const file = form.get("file");

    console.log({
      level: "info",
      phase: "upload_source_start",
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
      phase: "upload_source_complete",
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
    const lowerError = errorMessage.toLowerCase();

    console.error({
      level: "error",
      phase: "upload_source_error",
      error: errorMessage,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

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

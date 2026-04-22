import { apiError, apiOk } from "@/lib/server/api/responses";
import { validatePdfUpload } from "@/lib/server/api/upload-validation";
import { toInternalErrorMessage } from "@/lib/server/errors/classify";
import { createJobWithUpload } from "@/lib/server/jobs/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return apiError({
        httpStatus: 400,
        code: "validation_error",
        message: "file is required",
      });
    }
    const validation = validatePdfUpload(file);
    if (!validation.ok) {
      return apiError({
        httpStatus: 400,
        code: validation.code,
        message: validation.message,
      });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const job = await createJobWithUpload({
      originalFilename: file.name,
      fileBytes: bytes,
    });

    return apiOk({
      status: job.status,
      message: "Upload accepted and temporary job created.",
      job,
      data: {
        jobId: job.jobId,
        originalFilename: job.originalFilename,
      },
    });
  } catch (error) {
    return apiError({
      httpStatus: 500,
      code: "internal_error",
      message: toInternalErrorMessage(error),
    });
  }
}

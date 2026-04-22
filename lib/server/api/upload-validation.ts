import "server-only";

import type { TempJobErrorCode } from "@/lib/server/jobs/types";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const PDF_MIME_TYPES = new Set(["application/pdf"]);

export function validatePdfUpload(file: File): {
  ok: true;
} | {
  ok: false;
  code: TempJobErrorCode;
  message: string;
} {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return {
      ok: false,
      code: "validation_error",
      message: "Only PDF files (.pdf) are allowed.",
    };
  }
  if (file.size <= 0) {
    return {
      ok: false,
      code: "validation_error",
      message: "Uploaded file is empty.",
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "validation_error",
      message: `File is too large. Max size is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
    };
  }
  if (file.type && !PDF_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      code: "validation_error",
      message: "Invalid file MIME type. Please upload a standard PDF file.",
    };
  }
  return { ok: true };
}

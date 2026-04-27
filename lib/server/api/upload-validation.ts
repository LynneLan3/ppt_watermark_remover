import "server-only";

import { PDFDocument } from "pdf-lib";

import type { TempJobErrorCode } from "@/lib/server/jobs/types";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_PAGES = 30;
const PDF_MIME_TYPES = new Set(["application/pdf"]);

export async function validatePdfUpload(file: File): Promise<{
  ok: true;
} | {
  ok: false;
  code: TempJobErrorCode;
  message: string;
}> {
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
  try {
    const pdfBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(pdfBuffer);
    const pageCount = pdf.getPageCount();
    if (pageCount > MAX_UPLOAD_PAGES) {
      return {
        ok: false,
        code: "validation_error",
        message: `PDF has ${pageCount} pages. Current Beta supports up to ${MAX_UPLOAD_PAGES} pages per file.`,
      };
    }
  } catch {
    return {
      ok: false,
      code: "validation_error",
      message: "Failed to parse PDF. Please upload a standard NotebookLM export PDF.",
    };
  }
  return { ok: true };
}

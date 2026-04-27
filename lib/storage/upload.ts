import "server-only";

import { PDFDocument } from "pdf-lib";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_UPLOAD_PAGES = 30;

export async function validateUploadedPdf(file: File): Promise<
  | { ok: true; pageCount: number }
  | { ok: false; message: string }
> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return {
      ok: false,
      message: "Only PDF uploads are supported in Stage 2.",
    };
  }
  if (file.size <= 0) {
    return {
      ok: false,
      message: "Uploaded PDF is empty.",
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `PDF is too large. Max size is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`,
    };
  }
  try {
    const pdfBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(pdfBuffer);
    const pageCount = pdf.getPageCount();
    if (pageCount > MAX_UPLOAD_PAGES) {
      return {
        ok: false,
        message: `PDF has ${pageCount} pages. Current Beta supports up to ${MAX_UPLOAD_PAGES} pages per file.`,
      };
    }
    return { ok: true, pageCount };
  } catch {
    return {
      ok: false,
      message: "Failed to parse PDF. Please upload a standard NotebookLM export PDF.",
    };
  }
}

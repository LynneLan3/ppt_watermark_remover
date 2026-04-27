import "server-only";

import { PDFDocument } from "pdf-lib";

export type JsAnalyzeFallbackResult = {
  analyzer: "js-fallback";
  pageCount: number;
  documentMode: "raster_page";
  recommendedProcessMode: "raster_page";
  pages: Array<{
    page: number;
    status: "ready";
    watermarkRegionHint: {
      x: number;
      y: number;
      w: number;
      h: number;
    };
  }>;
};

export async function analyzePdfWithJsFallback(pdfBuffer: Buffer): Promise<JsAnalyzeFallbackResult> {
  const doc = await PDFDocument.load(pdfBuffer);
  const pageCount = doc.getPageCount();
  const safePageCount = Math.max(pageCount, 1);
  const pages = Array.from({ length: safePageCount }, (_, index) => ({
    page: index + 1,
    status: "ready" as const,
    watermarkRegionHint: {
      x: 0.74,
      y: 0.84,
      w: 0.24,
      h: 0.14,
    },
  }));

  return {
    analyzer: "js-fallback",
    pageCount: safePageCount,
    documentMode: "raster_page",
    recommendedProcessMode: "raster_page",
    pages,
  };
}

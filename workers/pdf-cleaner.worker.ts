import { PDFDocument, rgb } from "pdf-lib";

import { clampNormalizedRect, resolveTargetPages } from "../lib/local/pdf/range";
import type {
  LegacyPdfCoverWorkerRequest,
  LegacyPdfCoverWorkerResponse,
} from "../lib/local/pdf/types";

// Legacy internal worker for white-rectangle cover flow.
// This is intentionally demoted and is NOT the main user-facing object-removal workflow.
const workerScope = self as unknown as {
  onmessage: (event: MessageEvent<LegacyPdfCoverWorkerRequest>) => Promise<void>;
  postMessage: (
    message: LegacyPdfCoverWorkerResponse,
    transfer?: Transferable[],
  ) => void;
};

workerScope.onmessage = async (event: MessageEvent<LegacyPdfCoverWorkerRequest>) => {
  try {
    const {
      pdfBytes,
      selection,
      scope,
      currentPage,
      pageCount,
      rangeStart,
      rangeEnd,
    } = event.data;

    const targetPages = resolveTargetPages(
      scope,
      currentPage,
      pageCount,
      rangeStart,
      rangeEnd,
    );

    const safeSelection = clampNormalizedRect(selection);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    targetPages.forEach((pageNumber) => {
      const page = pdfDoc.getPage(pageNumber - 1);
      const { width, height } = page.getSize();

      const x = safeSelection.x * width;
      const drawWidth = safeSelection.width * width;
      const drawHeight = safeSelection.height * height;
      const y = height - safeSelection.y * height - drawHeight;

      page.drawRectangle({
        x,
        y,
        width: drawWidth,
        height: drawHeight,
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 1,
      });
    });

    const output = await pdfDoc.save();
    const outputBuffer = output.buffer.slice(0) as ArrayBuffer;
    const response: LegacyPdfCoverWorkerResponse = {
      ok: true,
      pdfBytes: outputBuffer,
    };
    workerScope.postMessage(response, [outputBuffer]);
  } catch (error) {
    const response: LegacyPdfCoverWorkerResponse = {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to clean PDF.",
    };
    workerScope.postMessage(response);
  }
};

export {};

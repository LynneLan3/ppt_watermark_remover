import type {
  LegacyPdfCoverWorkerRequest,
  LegacyPdfCoverWorkerResponse,
} from "@/lib/local/pdf/types";

// Legacy helper for rectangle cover flow. Not part of the primary object-level product path.
export async function runLegacyPdfCoverWorker(
  request: LegacyPdfCoverWorkerRequest,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../../workers/pdf-cleaner.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<LegacyPdfCoverWorkerResponse>) => {
      const response = event.data;
      worker.terminate();
      if (response.ok) {
        resolve(response.pdfBytes);
      } else {
        reject(new Error(response.error));
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Worker failed."));
    };

    const transferableBytes = request.pdfBytes.slice(0);
    worker.postMessage(
      { ...request, pdfBytes: transferableBytes },
      [transferableBytes],
    );
  });
}

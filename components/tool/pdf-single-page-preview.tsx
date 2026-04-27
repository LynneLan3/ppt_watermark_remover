"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type PdfSinglePagePreviewProps = {
  fileUrl: string | null;
  page: number;
  title: string;
  emptyMessage: string;
  headerPageText?: string;
  showInternalPageText?: boolean;
  strictPageMatch?: boolean;
  missingPageMessage?: string;
  onRenderSuccess?: () => void;
  onRenderError?: (message: string) => void;
  onDocumentLoad?: (pageCount: number) => void;
};

export function PdfSinglePagePreview({
  fileUrl,
  page,
  title,
  emptyMessage,
  headerPageText,
  showInternalPageText = true,
  strictPageMatch = false,
  missingPageMessage,
  onRenderSuccess,
  onRenderError,
  onDocumentLoad,
}: PdfSinglePagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [isPageUnavailable, setIsPageUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      if (!fileUrl) {
        setRenderError(null);
        setTotalPages(null);
        setIsPageUnavailable(false);
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      setIsRendering(true);
      setRenderError(null);
      setIsPageUnavailable(false);

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
        const fileBytes = await fetch(fileUrl).then((resp) => resp.arrayBuffer());
        const loadingTask = pdfjs.getDocument({ data: fileBytes });
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }

        setTotalPages(doc.numPages);
        onDocumentLoad?.(doc.numPages);

        if (strictPageMatch && page > doc.numPages) {
          setIsPageUnavailable(true);
          const context = canvas.getContext("2d");
          if (context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
          }
          canvas.width = 0;
          canvas.height = 0;
          await doc.destroy();
          return;
        }

        const targetPage = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(targetPage);
        const viewport = pdfPage.getViewport({ scale: 1.4 });
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas context unavailable");
        }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const renderTask = pdfPage.render({
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;

        onRenderSuccess?.();
        await doc.destroy();
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "render_failed";
          setRenderError(message);
          onRenderError?.(message);
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [fileUrl, onDocumentLoad, onRenderError, onRenderSuccess, page, strictPageMatch]);

  const pageText = useMemo(() => {
    if (headerPageText) {
      return headerPageText;
    }
    if (!showInternalPageText || !fileUrl) {
      return "";
    }
    if (!totalPages || totalPages <= 0) {
      return `Page ${Math.max(page, 1)}`;
    }
    return `Page ${Math.min(Math.max(page, 1), totalPages)} / ${totalPages}`;
  }, [fileUrl, headerPageText, page, showInternalPageText, totalPages]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {pageText ? <span className="text-xs text-slate-500">{pageText}</span> : null}
      </div>
      {!fileUrl ? (
        <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="mt-3 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
          {isRendering ? <p className="p-3 text-xs text-slate-500">Rendering page...</p> : null}
          {isPageUnavailable ? (
            <p className="p-3 text-xs text-slate-600">
              {missingPageMessage ?? "Preview not available for this page."}
            </p>
          ) : null}
          {renderError ? <p className="p-3 text-xs text-rose-600">Preview render failed: {renderError}</p> : null}
          {!isPageUnavailable ? (
            <canvas ref={canvasRef} className="mx-auto block h-auto max-w-full bg-white" />
          ) : null}
        </div>
      )}
    </section>
  );
}

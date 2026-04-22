"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";

import { PdfCandidateOverlay } from "@/components/app/pdf-candidate-overlay";
import type { UploadPageContent } from "@/content/pages/upload";
import { analyzePdfCandidates } from "@/lib/local/pdf/candidate-analysis";
import type {
  PdfCandidateAnalysisResult,
  PdfObjectCandidate,
} from "@/lib/local/pdf/types";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).toString();

type UploadPreviewWorkspaceProps = {
  content: UploadPageContent["placeholder"];
  fileBytes: ArrayBuffer | null;
  currentPage: number;
  onCurrentPageChange: (page: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPageCountChange: (count: number) => void;
  statusText: string;
  activeCandidateId: string | null;
  onActiveCandidateChange: (candidateId: string | null) => void;
  onCandidateAnalysisChange: (result: PdfCandidateAnalysisResult | null) => void;
  onLoadError: (message: string) => void;
  onLoadSuccess: () => void;
  onPhaseChange?: (phase: PreviewPhase) => void;
  backendAnalysisResult?: PdfCandidateAnalysisResult | null;
  useBackendCandidates?: boolean;
};

type CanvasSize = {
  width: number;
  height: number;
};

type PreviewPhase =
  | "idle"
  | "loading_document"
  | "document_ready"
  | "rendering_page"
  | "preview_ready"
  | "analyzing_candidates"
  | "analysis_ready"
  | "error";

const ANALYSIS_TIMEOUT_MS = 20000;

export function UploadPreviewWorkspace({
  content,
  fileBytes,
  currentPage,
  onCurrentPageChange,
  zoom,
  onZoomChange,
  onPageCountChange,
  statusText,
  activeCandidateId,
  onActiveCandidateChange,
  onCandidateAnalysisChange,
  onLoadError,
  onLoadSuccess,
  onPhaseChange,
  backendAnalysisResult = null,
  useBackendCandidates = false,
}: UploadPreviewWorkspaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(true);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const loadTokenRef = useRef(0);
  const lastLoadedFileRef = useRef<ArrayBuffer | null>(null);
  const docSessionCounterRef = useRef(0);
  const firstPreviewReadySessionRef = useRef<number | null>(null);
  const analyzedSessionRef = useRef<number | null>(null);
  const onLoadErrorRef = useRef(onLoadError);
  const onLoadSuccessRef = useRef(onLoadSuccess);
  const onPageCountChangeRef = useRef(onPageCountChange);
  const onCurrentPageChangeRef = useRef(onCurrentPageChange);
  const onCandidateAnalysisChangeRef = useRef(onCandidateAnalysisChange);
  const onActiveCandidateChangeRef = useRef(onActiveCandidateChange);
  const onPhaseChangeRef = useRef(onPhaseChange);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [phase, setPhase] = useState<PreviewPhase>("idle");
  const [docSessionId, setDocSessionId] = useState(0);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [zoomMode, setZoomMode] = useState<"fit" | "manual">("fit");
  const [effectiveScale, setEffectiveScale] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<PdfCandidateAnalysisResult | null>(
    null,
  );

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
    onLoadSuccessRef.current = onLoadSuccess;
    onPageCountChangeRef.current = onPageCountChange;
    onCurrentPageChangeRef.current = onCurrentPageChange;
    onCandidateAnalysisChangeRef.current = onCandidateAnalysisChange;
    onActiveCandidateChangeRef.current = onActiveCandidateChange;
    onPhaseChangeRef.current = onPhaseChange;
  }, [
    onLoadError,
    onLoadSuccess,
    onPageCountChange,
    onCurrentPageChange,
    onCandidateAnalysisChange,
    onActiveCandidateChange,
    onPhaseChange,
  ]);

  useEffect(() => {
    onPhaseChangeRef.current?.(phase);
  }, [phase]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      if (renderTaskRef.current) {
        void cancelRenderTask(renderTaskRef.current);
        renderTaskRef.current = null;
      }
      if (loadingTaskRef.current) {
        void loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        void pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const node = previewViewportRef.current;
    if (!node) {
      return;
    }

    const updateViewport = () => {
      const width = Math.max(0, node.clientWidth - 24);
      const height = Math.max(0, node.clientHeight - 24);
      setViewportSize({ width, height });
    };
    updateViewport();

    const observer = new ResizeObserver(() => {
      updateViewport();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    loadTokenRef.current += 1;
    const loadToken = loadTokenRef.current;

    const loadPdf = async () => {
      const isStale = () =>
        !mountedRef.current || loadToken !== loadTokenRef.current;

      if (renderTaskRef.current) {
        void cancelRenderTask(renderTaskRef.current);
        renderTaskRef.current = null;
      }
      if (loadingTaskRef.current) {
        await loadingTaskRef.current.destroy();
        loadingTaskRef.current = null;
      }
      if (pdfDocRef.current) {
        await pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }

      setAnalysisResult(null);
      setZoomMode("fit");
      onCandidateAnalysisChangeRef.current(null);
      onActiveCandidateChangeRef.current(null);
      analyzedSessionRef.current = null;
      firstPreviewReadySessionRef.current = null;
      setDocSessionId(0);
      setLoadError(null);
      setCanvasSize({ width: 0, height: 0 });
      setPdfDoc(null);

      if (!fileBytes) {
        if (isStale()) {
          return;
        }
        lastLoadedFileRef.current = null;
        onPageCountChangeRef.current(0);
        setPhase("idle");
        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] idle (no file selected)");
        }
        return;
      }

      if (lastLoadedFileRef.current === fileBytes) {
        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] load skipped (same file reference)");
        }
        return;
      }
      lastLoadedFileRef.current = fileBytes;

      try {
        setPhase("loading_document");
        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] file selected", {
            bytes: fileBytes.byteLength,
          });
        }

        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] getDocument start", { loadToken });
        }
        const task = getDocument({ data: fileBytes.slice(0) });
        loadingTaskRef.current = task;
        const loaded = await task.promise;
        if (isStale()) {
          void loaded.destroy();
          return;
        }

        pdfDocRef.current = loaded;
        setPdfDoc(loaded);
        onPageCountChangeRef.current(loaded.numPages);
        const nextSessionId = docSessionCounterRef.current + 1;
        docSessionCounterRef.current = nextSessionId;
        setDocSessionId(nextSessionId);
        firstPreviewReadySessionRef.current = null;
        analyzedSessionRef.current = null;
        onCurrentPageChangeRef.current(1);
        onZoomChange(1);
        setPhase("document_ready");

        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] getDocument success", {
            loadToken,
            numPages: loaded.numPages,
            sessionId: nextSessionId,
          });
          console.info("[upload-preview] pageCount set", {
            pageCount: loaded.numPages,
          });
        }
        onLoadSuccessRef.current();
      } catch (error) {
        if (isExpectedPdfJsCancellation(error)) {
          if (process.env.NODE_ENV !== "production") {
            console.info("[upload-preview] getDocument cancelled (expected)", {
              message: toErrorMessage(error),
            });
          }
          return;
        }
        if (isStale()) {
          return;
        }

        setPdfDoc(null);
        onPageCountChangeRef.current(0);
        const message = error instanceof Error ? error.message : "Failed to read PDF file.";
        setLoadError(message);
        setPhase("error");
        if (process.env.NODE_ENV !== "production") {
          console.error("[upload-preview] getDocument failure", { message });
        }
        onLoadErrorRef.current("This PDF could not be opened. Please try a readable PDF file.");
      } finally {
        if (loadingTaskRef.current && loadToken === loadTokenRef.current) {
          loadingTaskRef.current = null;
        }
      }
    };

    void loadPdf();
  }, [fileBytes, onZoomChange]);

  useEffect(() => {
    let isEffectActive = true;

    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current) {
        return;
      }

      const safePage = Math.max(1, Math.min(currentPage, pdfDoc.numPages));
      if (safePage !== currentPage) {
        onCurrentPageChange(safePage);
        return;
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      if (renderTaskRef.current) {
        void cancelRenderTask(renderTaskRef.current);
        renderTaskRef.current = null;
      }

      setPhase("rendering_page");
      try {
        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] render page start", {
            page: safePage,
            zoom,
            sessionId: docSessionId,
          });
        }
        const page = await pdfDoc.getPage(safePage);
        const baseViewport = page.getViewport({ scale: 1 });
        const fitScale = computeFitScale(
          baseViewport.width,
          baseViewport.height,
          viewportSize.width,
          viewportSize.height,
        );
        const renderScale = zoomMode === "fit" ? fitScale : zoom;
        const viewport = page.getViewport({ scale: renderScale });
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewport.width, viewport.height);

        const task = page.render({
          canvasContext: ctx,
          viewport,
        });
        renderTaskRef.current = task;
        const renderResult = await task.promise.catch((error) => {
          if (isExpectedRenderCancellation(error)) {
            return "cancelled" as const;
          }
          throw error;
        });
        if (renderResult === "cancelled") {
          if (process.env.NODE_ENV !== "production") {
            console.info("[upload-preview] render cancelled (expected)", {
              page: safePage,
              sessionId: docSessionId,
            });
          }
          if (isEffectActive && mountedRef.current) {
            setPhase((prev) =>
              prev === "analyzing_candidates" || prev === "analysis_ready"
                ? prev
                : "preview_ready",
            );
          }
          return;
        }
        if (isEffectActive && mountedRef.current) {
          setCanvasSize({ width: viewport.width, height: viewport.height });
          setEffectiveScale(renderScale);
          if (process.env.NODE_ENV !== "production") {
            console.info("[upload-preview] render page success", {
              page: safePage,
              width: viewport.width,
              height: viewport.height,
              scale: renderScale,
              zoomMode,
              sessionId: docSessionId,
            });
          }

          if (firstPreviewReadySessionRef.current !== docSessionId && safePage === 1) {
            firstPreviewReadySessionRef.current = docSessionId;
            setPhase("preview_ready");
            if (process.env.NODE_ENV !== "production") {
              console.info("[upload-preview] preview ready", { sessionId: docSessionId });
            }
          } else {
            setPhase((prev) =>
              prev === "analyzing_candidates" || prev === "analysis_ready"
                ? prev
                : "preview_ready",
            );
          }
        }
      } catch (error) {
        if (isExpectedRenderCancellation(error)) {
          if (process.env.NODE_ENV !== "production") {
            console.info("[upload-preview] render cancelled (expected)", {
              message: error instanceof Error ? error.message : String(error),
              page: safePage,
              sessionId: docSessionId,
            });
          }
          if (isEffectActive && mountedRef.current) {
            setPhase((prev) =>
              prev === "analyzing_candidates" || prev === "analysis_ready"
                ? prev
                : "preview_ready",
            );
          }
          return;
        }
        if (isEffectActive && mountedRef.current) {
          const message = error instanceof Error ? error.message : "Failed to render PDF page.";
          setLoadError(message);
          setPhase("error");
          if (process.env.NODE_ENV !== "production") {
            console.error("[upload-preview] render page failure", { message });
          }
          onLoadErrorRef.current("We could not render this page. Try another PDF or reload.");
        }
      } finally {
        if (renderTaskRef.current === null || !isEffectActive || !mountedRef.current) {
          return;
        }
        renderTaskRef.current = null;
      }
    };

    void renderPage();

    return () => {
      isEffectActive = false;
      if (renderTaskRef.current) {
        void cancelRenderTask(renderTaskRef.current);
        renderTaskRef.current = null;
      }
    };
  }, [
    pdfDoc,
    currentPage,
    zoom,
    zoomMode,
    viewportSize.width,
    viewportSize.height,
    onCurrentPageChange,
    docSessionId,
  ]);

  useEffect(() => {
    let active = true;
    const runAnalysis = async () => {
      if (useBackendCandidates) {
        return;
      }
      if (!pdfDoc || phase !== "preview_ready" || docSessionId <= 0) {
        return;
      }
      if (analyzedSessionRef.current === docSessionId) {
        return;
      }

      setPhase("analyzing_candidates");
      if (process.env.NODE_ENV !== "production") {
        console.info("[upload-preview] candidate analysis start", {
          sessionId: docSessionId,
        });
      }

      try {
        const analysis = await withTimeout(
          analyzePdfCandidates(pdfDoc),
          ANALYSIS_TIMEOUT_MS,
          "Candidate analysis timed out. Please retry with a smaller or simpler PDF.",
        );
        if (!active || !mountedRef.current || docSessionId !== docSessionCounterRef.current) {
          return;
        }
        analyzedSessionRef.current = docSessionId;
        setAnalysisResult(analysis);
        onCandidateAnalysisChangeRef.current(analysis);
        setPhase("analysis_ready");
        if (process.env.NODE_ENV !== "production") {
          console.info("[upload-preview] candidate analysis success", {
            sessionId: docSessionId,
            candidates: analysis.totalCandidates,
          });
        }
      } catch (error) {
        if (!active || !mountedRef.current) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Candidate analysis failed.";
        setPhase("error");
        setLoadError(message);
        if (process.env.NODE_ENV !== "production") {
          console.error("[upload-preview] candidate analysis failure", {
            sessionId: docSessionId,
            message,
          });
        }
        onLoadErrorRef.current(
          "PDF loaded but candidate analysis failed. Retry by reloading this PDF or using a smaller file.",
        );
      } finally {
        // phase transitions control analysis badge visibility.
      }
    };

    void runAnalysis();
    return () => {
      active = false;
    };
  }, [pdfDoc, phase, docSessionId, useBackendCandidates]);

  const pageButtons = useMemo(() => {
    if (!pdfDoc) {
      return [];
    }
    const count = Math.min(pdfDoc.numPages, 60);
    return Array.from({ length: count }, (_, idx) => idx + 1);
  }, [pdfDoc]);

  const currentPageCandidates = useMemo(() => {
    const source = useBackendCandidates ? backendAnalysisResult : analysisResult;
    if (!source) {
      return [];
    }
    return (source.candidatesByPage[currentPage] ?? []).filter(
      (candidate) => candidate.objectType !== "unsupported_region",
    );
  }, [analysisResult, backendAnalysisResult, currentPage, useBackendCandidates]);

  const phaseMessage = useMemo(() => {
    if (phase === "loading_document") {
      return "Uploading NotebookLM export...";
    }
    if (phase === "rendering_page") {
      return "Preview cleaned result...";
    }
    if (phase === "analyzing_candidates") {
      return "Analyzing watermark candidates...";
    }
    return null;
  }, [phase]);

  const handleCanvasClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!canvasSize.width || !canvasSize.height) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    const candidate = findBestCandidateAtPoint(currentPageCandidates, x, y);
    onActiveCandidateChange(candidate?.id ?? null);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <p className="text-sm font-semibold text-slate-900">{content.panelTitle}</p>
        <p className="text-xs text-slate-600">{statusText}</p>
      </div>

      <div className="mt-4 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">{content.pageNavLabel}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!pdfDoc || currentPage <= 1}
              onClick={() => onCurrentPageChange(Math.max(1, currentPage - 1))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!pdfDoc || currentPage >= (pdfDoc?.numPages ?? 1)}
              onClick={() =>
                onCurrentPageChange(Math.min(pdfDoc?.numPages ?? 1, currentPage + 1))
              }
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
            >
              Next
            </button>
            <button
              type="button"
              disabled={!pdfDoc}
              onClick={() => setZoomMode("fit")}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50"
            >
              Fit
            </button>
            <p className="text-xs text-slate-600">
              {content.zoomLabel}: {Math.round(effectiveScale * 100)}%
            </p>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {pageButtons.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => onCurrentPageChange(page)}
                className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs ${
                  page === currentPage
                    ? "border-sky-500 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                {page}
              </button>
            ))}
            {pdfDoc && pdfDoc.numPages > pageButtons.length ? (
              <p className="self-center text-[11px] text-slate-500">
                More pages available...
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setZoomMode("manual");
                  onZoomChange(Math.max(0.6, zoom - 0.1));
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomMode("manual");
                  onZoomChange(Math.min(2.5, zoom + 0.1));
                }}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
              >
                +
              </button>
              <span className="text-xs text-slate-600">
                {zoomMode === "fit" ? "Auto fit enabled" : "Manual zoom"}
              </span>
            </div>

            <div
              ref={previewViewportRef}
              className="overflow-auto rounded-lg border border-slate-200 bg-white p-3"
              style={{ minHeight: 520, maxHeight: "72vh" }}
            >
              {fileBytes && !loadError ? (
                pdfDoc ? (
                  <div
                    className="relative mx-auto"
                    style={{
                      width: canvasSize.width ? `${canvasSize.width}px` : "100%",
                      minHeight: "320px",
                    }}
                    onClick={handleCanvasClick}
                  >
                    <canvas ref={canvasRef} className="mx-auto block border border-slate-200" />
                    {canvasSize.width > 0 && canvasSize.height > 0 ? (
                      <PdfCandidateOverlay
                        candidates={currentPageCandidates}
                        activeCandidateId={activeCandidateId}
                      />
                    ) : null}
                    {phaseMessage ? (
                      <p className="absolute inset-x-0 top-2 text-center text-xs text-slate-600">
                        {phaseMessage}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex h-80 items-center justify-center text-center">
                    <p className="max-w-sm text-xs text-slate-500">
                      {phase === "loading_document"
                        ? "Uploading NotebookLM export..."
                        : "Preparing preview..."}
                    </p>
                  </div>
                )
              ) : (
                <div className="flex h-80 items-center justify-center text-center">
                  <p className="max-w-sm text-xs text-slate-500">
                    {loadError ?? "Load a local PDF to inspect candidate objects."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                {content.selectionLabel}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Click near a logo/header/footer to select independent object candidates.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{content.resultLabel}</p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                This stage prepares object-level removal plans for dedicated PDF engines.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function findBestCandidateAtPoint(
  candidates: PdfObjectCandidate[],
  x: number,
  y: number,
): PdfObjectCandidate | null {
  const containing = candidates.filter((candidate) =>
    containsPoint(candidate.normalizedBoundingBox, x, y),
  );

  const pool = containing.length > 0 ? containing : candidates;
  if (pool.length === 0) {
    return null;
  }

  let best: PdfObjectCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of pool) {
    const centerX =
      candidate.normalizedBoundingBox.x + candidate.normalizedBoundingBox.width / 2;
    const centerY =
      candidate.normalizedBoundingBox.y + candidate.normalizedBoundingBox.height / 2;
    const dx = centerX - x;
    const dy = centerY - y;
    const distance = Math.hypot(dx, dy);
    const confidenceBonus = (1 - candidate.confidence) * 0.15;
    const score = distance + confidenceBonus;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  if (!containsPoint(best?.normalizedBoundingBox ?? null, x, y) && bestScore > 0.16) {
    return null;
  }
  return best;
}

function computeFitScale(
  pageWidth: number,
  pageHeight: number,
  containerWidth: number,
  containerHeight: number,
): number {
  if (pageWidth <= 0 || pageHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return 1;
  }
  const widthScale = containerWidth / pageWidth;
  const heightScale = containerHeight / pageHeight;
  const scale = Math.min(widthScale, heightScale);
  return Math.max(0.4, Math.min(2.5, scale));
}

function containsPoint(
  bbox: PdfObjectCandidate["normalizedBoundingBox"] | null,
  x: number,
  y: number,
): boolean {
  if (!bbox) {
    return false;
  }
  return (
    x >= bbox.x &&
    x <= bbox.x + bbox.width &&
    y >= bbox.y &&
    y <= bbox.y + bbox.height
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await new Promise<T>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      void promise.then(resolve).catch(reject);
    });
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function isExpectedRenderCancellation(error: unknown): boolean {
  if (typeof error === "string") {
    return error.toLowerCase().includes("rendering cancelled");
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybeError = error as { name?: string; message?: string };
  const name = (maybeError.name ?? "").toLowerCase();
  const message = (maybeError.message ?? "").toLowerCase();
  return name.includes("renderingcancelledexception") || message.includes("rendering cancelled");
}

function isExpectedPdfJsCancellation(error: unknown): boolean {
  if (isExpectedRenderCancellation(error)) {
    return true;
  }
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("abort") ||
    message.includes("destroyed")
  );
}

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "unknown";
}

async function cancelRenderTask(task: RenderTask): Promise<void> {
  try {
    task.cancel();
    await task.promise.catch(() => undefined);
  } catch {
    // Ignore cancellation errors from stale render tasks.
  }
}

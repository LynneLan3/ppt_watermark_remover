"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { PdfSinglePagePreview } from "@/components/tool/pdf-single-page-preview";
import type { HomeToolContent } from "@/content/pages/home-tool";
import type { JobApiResponse, JobRecord, ProcessReportV2 } from "@/lib/jobs/types";

type UploadHeroProps = {
  content: HomeToolContent["uploadHero"];
};

type FeedbackType =
  | "looks_good"
  | "still_has_residue"
  | "white_patch"
  | "text_or_line_damaged"
  | "other";

type WorkflowState = "idle" | "processing" | "ready_for_download" | "failed";

type ProcessingStage = "uploading" | "analyzing" | "removing" | "preparing";

const FEEDBACK_OPTIONS: Array<{ value: FeedbackType; label: string }> = [
  { value: "looks_good", label: "Looks good" },
  { value: "still_has_residue", label: "Still has residue" },
  { value: "white_patch", label: "White patch" },
  { value: "text_or_line_damaged", label: "Text / line damaged" },
  { value: "other", label: "Other" },
];

const STAGE_TEXT: Record<ProcessingStage, string> = {
  uploading: "Uploading your PDF...",
  analyzing: "Preparing cleanup...",
  removing: "Removing NotebookLM watermark...",
  preparing: "Preparing preview...",
};

export function UploadHero({ content }: UploadHeroProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [processReport, setProcessReport] = useState<ProcessReportV2 | null>(null);
  const [workflowState, setWorkflowState] = useState<WorkflowState>("idle");
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("uploading");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [sourcePageCount, setSourcePageCount] = useState<number | null>(null);
  const [processedPageCount, setProcessedPageCount] = useState<number | null>(null);

  const [originalPdfUrl, setOriginalPdfUrl] = useState<string | null>(null);
  const [processedPdfUrl, setProcessedPdfUrl] = useState<string | null>(null);
  const [processedPreviewReady, setProcessedPreviewReady] = useState(false);
  const [processedPreviewError, setProcessedPreviewError] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState("");
  const [debugQueryEnabled, setDebugQueryEnabled] = useState(false);
  const pipelineRunIdRef = useRef(0);

  const fileSizeText = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    const mb = selectedFile.size / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }, [selectedFile]);

  const sharedTotalPages = useMemo(() => {
    const known = sourcePageCount ?? processReport?.inputPageCount ?? 0;
    return known > 0 ? known : 1;
  }, [processReport?.inputPageCount, sourcePageCount]);

  const hasPageCountMismatch =
    processedPageCount !== null && sourcePageCount !== null && processedPageCount !== sourcePageCount;

  const canDownload =
    workflowState === "ready_for_download" &&
    job?.status === "ready_for_download" &&
    Boolean(processedPdfUrl) &&
    !hasPageCountMismatch &&
    processedPreviewReady &&
    !isDownloading;

  const canGiveFeedback =
    workflowState === "ready_for_download" &&
    Boolean(job?.jobId) &&
    Boolean(processedPdfUrl) &&
    !isSubmittingFeedback;
  const isInternalReviewVisible =
    process.env.NEXT_PUBLIC_ENABLE_INTERNAL_REVIEW === "true" || debugQueryEnabled;

  useEffect(() => {
    return () => {
      if (originalPdfUrl) {
        URL.revokeObjectURL(originalPdfUrl);
      }
    };
  }, [originalPdfUrl]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const parseDebugFlag = () => {
      const debug = new URLSearchParams(window.location.search).get("debug") === "1";
      setDebugQueryEnabled(debug);
    };

    const scrollToHomepageUpload = () => {
      if (window.location.hash !== "#homepage-upload") {
        return;
      }
      const anchor = document.getElementById("homepage-upload");
      if (!anchor) {
        return;
      }
      window.requestAnimationFrame(() => {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    parseDebugFlag();
    scrollToHomepageUpload();
    window.addEventListener("hashchange", scrollToHomepageUpload);
    window.addEventListener("popstate", parseDebugFlag);
    return () => {
      window.removeEventListener("hashchange", scrollToHomepageUpload);
      window.removeEventListener("popstate", parseDebugFlag);
    };
  }, []);

  useEffect(() => {
    const file = selectedFile;
    if (!file) {
      return;
    }

    let cancelled = false;

    async function loadPageCount() {
      try {
        const pageCount = await readPdfPageCountFromFile(file as File);
        if (!cancelled) {
          setSourcePageCount(pageCount);
        }
      } catch {
        if (!cancelled) {
          setSourcePageCount(null);
        }
      }
    }

    void loadPageCount();

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  useEffect(() => {
    if (!processedPdfUrl || workflowState === "processing") {
      return;
    }

    let cancelled = false;

    async function loadProcessedPageCount() {
      try {
        const pageCount = await readPdfPageCountFromUrl(processedPdfUrl as string);
        if (!cancelled) {
          setProcessedPageCount(pageCount);
        }
      } catch {
        if (!cancelled) {
          setProcessedPageCount(null);
        }
      }
    }

    void loadProcessedPageCount();

    return () => {
      cancelled = true;
    };
  }, [processedPdfUrl, workflowState]);

  const openPicker = () => {
    if (workflowState === "processing" || workflowState === "ready_for_download") {
      return;
    }
    inputRef.current?.click();
  };

  const resetJobState = () => {
    setJob(null);
    setProcessReport(null);
    setCurrentPage(1);
    setProcessedPdfUrl(null);
    setProcessedPreviewReady(false);
    setProcessedPreviewError(null);
    setProcessedPageCount(null);
    setFeedbackNote("");
  };

  const handleSelectFile = (list: FileList | null) => {
    const file = list?.[0];
    if (!file) {
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setErrorMessage("PDF only. Please upload a PDF file.");
      return;
    }

    setSelectedFile(file);
    setSourcePageCount(null);
    const nextOriginalUrl = URL.createObjectURL(file);
    setOriginalPdfUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return nextOriginalUrl;
    });

    resetJobState();
    setErrorMessage(null);
    setNoticeMessage(null);
    setWorkflowState("processing");
    setProcessingStage("uploading");
    const runId = pipelineRunIdRef.current + 1;
    pipelineRunIdRef.current = runId;
    void runProcessingPipeline(file, runId);
  };

  const handleDrop = (event: React.DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    if (workflowState === "processing" || workflowState === "ready_for_download") {
      return;
    }
    handleSelectFile(event.dataTransfer.files);
  };

  const runProcessingPipeline = async (file: File, runId: number) => {
    setErrorMessage(null);
    setNoticeMessage(null);
    setProcessedPdfUrl(null);
    setProcessedPreviewReady(false);
    setProcessedPreviewError(null);
    setProcessedPageCount(null);

    const isStale = () => runId !== pipelineRunIdRef.current;

    try {
      setProcessingStage("uploading");
      const createResp = await fetch("/api/jobs/create", { method: "POST" });
      const created = (await createResp.json()) as JobApiResponse<{ jobId: string }>;
      if (!createResp.ok || !created.success || !created.data?.jobId) {
        throw new Error(created.message || "create job failed");
      }

      const jobId = created.data.jobId;
      if (isStale()) {
        return;
      }
      setJob(created.job ?? null);

      const tokenResp = await fetch("/api/jobs/upload-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const tokenResult = (await tokenResp.json()) as JobApiResponse<{ uploadToken: string }>;
      if (!tokenResp.ok || !tokenResult.success || !tokenResult.data?.uploadToken) {
        throw new Error(tokenResult.message || "issue upload token failed");
      }

      const uploadForm = new FormData();
      uploadForm.set("jobId", jobId);
      uploadForm.set("uploadToken", tokenResult.data.uploadToken);
      uploadForm.set("file", file);
      const uploadResp = await fetch("/api/jobs/upload-token", {
        method: "POST",
        body: uploadForm,
      });
      const uploaded = (await uploadResp.json()) as JobApiResponse<Record<string, unknown>>;
      if (!uploadResp.ok || !uploaded.success) {
        throw new Error(uploaded.message || "upload failed");
      }

      if (isStale()) {
        return;
      }
      setJob(uploaded.job ?? tokenResult.job ?? created.job ?? null);

      setProcessingStage("analyzing");
      const analyzeResp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/analyze`, {
        method: "POST",
      });
      const analyzeResult = (await analyzeResp.json()) as JobApiResponse<Record<string, unknown>>;
      if (!analyzeResp.ok || !analyzeResult.success) {
        throw new Error(
          (analyzeResult as { message?: string }).message ||
            "Analysis failed. Please try another PDF or report this file.",
        );
      }
      if (isStale()) {
        return;
      }
      setJob(analyzeResult.job ?? null);

      setProcessingStage("removing");
      const processResp = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ processMode: "raster_repair_v1" }),
      });
      const processResult = (await processResp.json()) as JobApiResponse<Record<string, unknown>>;
      if (!processResp.ok || !processResult.success) {
        throw new Error(
          (processResult as { message?: string }).message ||
            "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
        );
      }

      await pollJobStatus(jobId, ["ready_for_download", "failed", "partial_failed"], isStale);
      if (isStale()) {
        return;
      }
      const latest = await fetchJobState(jobId);
      if (latest.job?.status === "failed" || latest.job?.status === "partial_failed") {
        throw new Error(
          latest.job.failureMessage ||
            "Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or report this file.",
        );
      }

      setProcessingStage("preparing");
      setProcessedPdfUrl(`/api/jobs/${encodeURIComponent(jobId)}/preview`);
      setNoticeMessage("Preview is ready. Review both sides page by page before downloading.");
      setWorkflowState("ready_for_download");
      document.getElementById("result-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (isStale()) {
        return;
      }
      setWorkflowState("failed");
      setErrorMessage(error instanceof Error ? error.message : "Processing failed.");
      setNoticeMessage(null);
    }
  };

  const handleRetry = () => {
    if (!selectedFile) {
      return;
    }
    const runId = pipelineRunIdRef.current + 1;
    pipelineRunIdRef.current = runId;
    setWorkflowState("processing");
    setProcessingStage("uploading");
    void runProcessingPipeline(selectedFile, runId);
  };

  const handleProcessAnother = () => {
    pipelineRunIdRef.current += 1;
    if (originalPdfUrl) {
      URL.revokeObjectURL(originalPdfUrl);
    }
    setSelectedFile(null);
    setOriginalPdfUrl(null);
    setSourcePageCount(null);
    resetJobState();
    setErrorMessage(null);
    setNoticeMessage(null);
    setWorkflowState("idle");
    setProcessedPageCount(null);
  };

  const handleDownload = async () => {
    if (!job?.jobId) {
      setErrorMessage("Job not found. Cannot download.");
      return;
    }
    if (!canDownload) {
      setErrorMessage("Download is available only after cleaned preview is ready.");
      return;
    }

    setIsDownloading(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/jobs/${job.jobId}/download`);
      if (!response.ok) {
        const maybeError = (await response.json().catch(() => null)) as JobApiResponse<unknown> | null;
        throw new Error(maybeError?.message || "download failed");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${job.jobId}.processed.pdf`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setNoticeMessage("Download complete.");
      await fetchJobState(job.jobId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleFeedback = async (feedbackType: FeedbackType) => {
    if (!job?.jobId) {
      return;
    }

    setIsSubmittingFeedback(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/jobs/${job.jobId}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page: boundedCurrentPage,
          feedbackType,
          note: feedbackNote,
        }),
      });
      const result = (await response.json()) as JobApiResponse<Record<string, unknown>>;
      if (!response.ok || !result.success) {
        throw new Error(result.message || "feedback failed");
      }
      setNoticeMessage(`Feedback saved for page ${boundedCurrentPage}: ${feedbackType}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save feedback.");
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  async function fetchJobState(jobId: string): Promise<{
    job: JobRecord | null;
    processReport: ProcessReportV2 | null;
  }> {
    const response = await fetch(`/api/jobs/${jobId}`);
    const result = (await response.json()) as JobApiResponse<{
      processReport?: ProcessReportV2 | null;
    }>;
    if (!response.ok || !result.success) {
      throw new Error(result.message || "fetch job status failed");
    }
    setJob(result.job ?? null);
    setProcessReport(result.data?.processReport ?? null);
    return {
      job: result.job ?? null,
      processReport: result.data?.processReport ?? null,
    };
  }

  async function pollJobStatus(
    jobId: string,
    terminalStatuses: Array<"ready_for_download" | "failed" | "partial_failed">,
    isStale: () => boolean,
  ): Promise<void> {
    const maxAttempts = 120;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (isStale()) {
        return;
      }
      const latestJob = await fetchJobState(jobId);
      if (
        latestJob.job &&
        terminalStatuses.includes(latestJob.job.status as "ready_for_download" | "failed" | "partial_failed")
      ) {
        return;
      }
      if (attempt > 2) {
        setProcessingStage("removing");
      }
      await sleep(1000);
    }
    throw new Error("Processing timed out. Please retry with a smaller PDF or fewer pages.");
  }

  const boundedCurrentPage = clampNumber(currentPage, 1, sharedTotalPages);
  const pageLabel = `Page ${boundedCurrentPage} / ${sharedTotalPages}`;
  const showPreview = workflowState === "ready_for_download";

  const showDownloadButton =
    workflowState === "ready_for_download" &&
    job?.status === "ready_for_download" &&
    Boolean(processedPdfUrl) &&
    !hasPageCountMismatch &&
    processedPreviewReady;

  const canRenderCleanedPreview =
    workflowState === "ready_for_download" &&
    job?.status === "ready_for_download" &&
    Boolean(processedPdfUrl) &&
    !hasPageCountMismatch;

  return (
    <section className="px-4 py-8 sm:px-6 sm:py-10">
      {workflowState === "processing" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 backdrop-blur-[1px]">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-700" />
            <p className="mt-4 text-center text-base font-semibold text-slate-900">Processing your file</p>
            <p className="mt-2 text-center text-sm text-slate-600">{STAGE_TEXT[processingStage]}</p>
          </div>
        </div>
      ) : null}

      <div id="homepage-upload" className="mx-auto max-w-5xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">{content.eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{content.title}</h1>
        <p className="mt-3 text-base leading-7 text-slate-600">{content.description}</p>

        <button
          type="button"
          onClick={openPicker}
          onDragOver={(event) => {
            event.preventDefault();
            if (workflowState !== "processing" && workflowState !== "ready_for_download") {
              setIsDragActive(true);
            }
          }}
          onDragLeave={() => setIsDragActive(false)}
          onDrop={handleDrop}
          disabled={workflowState === "processing" || workflowState === "ready_for_download"}
          className={`mt-6 w-full rounded-2xl border-2 border-dashed px-6 py-16 text-left transition-colors ${
            isDragActive ? "border-sky-400 bg-sky-50" : "border-slate-300 bg-slate-50"
          } disabled:cursor-not-allowed disabled:opacity-70`}
        >
          <p className="text-2xl font-semibold text-slate-900">Upload PDF</p>
          <p className="mt-3 text-base text-slate-700">Drag and drop your NotebookLM PDF here</p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1">PDF only</span>
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1">Temporary upload</span>
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1">Auto delete</span>
            <span className="rounded-full border border-slate-300 bg-white px-3 py-1">No training</span>
          </div>
        </button>

        {selectedFile ? (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Selected file</p>
            <div className="mt-2 grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
              <p className="truncate">Name: {selectedFile.name}</p>
              <p>Size: {fileSizeText ?? "Unknown"}</p>
              <p>Pages: {sourcePageCount ?? "Detecting..."}</p>
            </div>
          </div>
        ) : null}

        {workflowState === "failed" ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleRetry}
              className="inline-flex w-full items-center justify-center rounded-xl bg-sky-700 px-6 py-4 text-base font-semibold text-white transition-colors hover:bg-sky-800"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={handleProcessAnother}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-6 py-4 text-base font-semibold text-slate-800 transition-colors hover:bg-slate-50"
            >
              Upload another PDF
            </button>
          </div>
        ) : null}

        {(workflowState === "idle" || workflowState === "failed") && (
          <div className="mt-3">
            <Link
              href={content.secondaryCta.href}
              className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.secondaryCta.label}
            </Link>
          </div>
        )}

        {errorMessage ? (
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</p>
        ) : null}
        {noticeMessage ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {noticeMessage}
          </p>
        ) : null}

        {hasPageCountMismatch ? (
          <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            Processing failed before all pages were completed. No cleaned PDF was generated. Please try another PDF or
            report this file.
          </p>
        ) : null}

        <p className="mt-3 text-xs text-slate-500">{content.uploadCard.hint}</p>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(event) => handleSelectFile(event.target.files)}
        />
      </div>

      {showPreview ? (
        <div id="result-preview" className="mx-auto mt-8 max-w-6xl space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <PdfSinglePagePreview
              title="Original PDF preview"
              fileUrl={originalPdfUrl}
              page={boundedCurrentPage}
              headerPageText={pageLabel}
              showInternalPageText={false}
              strictPageMatch
              emptyMessage="Original PDF preview appears after upload."
            />
            <PdfSinglePagePreview
              title="Cleaned PDF preview"
              fileUrl={canRenderCleanedPreview ? processedPdfUrl : null}
              page={boundedCurrentPage}
              headerPageText={pageLabel}
              showInternalPageText={false}
              strictPageMatch
              missingPageMessage="Cleaned preview not available for this page yet"
              emptyMessage={
                hasPageCountMismatch
                  ? "Processing failed before all pages were completed. No cleaned PDF was generated."
                  : "Cleaned preview is available only after processing is fully completed."
              }
              onDocumentLoad={(count) => {
                setProcessedPageCount((prev) => (prev === count ? prev : count));
              }}
              onRenderSuccess={() => {
                if (!processedPreviewReady) {
                  setProcessedPreviewReady(true);
                }
                if (processedPreviewError) {
                  setProcessedPreviewError(null);
                }
              }}
              onRenderError={(message) => {
                setProcessedPreviewError(message);
                setProcessedPreviewReady(false);
              }}
            />
          </div>

          <div className="mx-auto mt-4 max-w-6xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setCurrentPage(Math.max(1, boundedCurrentPage - 1))}
                disabled={boundedCurrentPage <= 1}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous page
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(sharedTotalPages, boundedCurrentPage + 1))}
                disabled={boundedCurrentPage >= sharedTotalPages}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next page
              </button>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                Page
                <input
                  type="number"
                  min={1}
                  max={sharedTotalPages}
                  value={boundedCurrentPage}
                  onChange={(event) => setCurrentPage(clampNumber(Number(event.target.value), 1, sharedTotalPages))}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
                />
                / {sharedTotalPages}
              </label>
            </div>
            {hasPageCountMismatch ? (
              <p className="mt-3 text-xs text-rose-700">
                Processing failed before all pages were completed. No cleaned PDF was generated.
              </p>
            ) : null}
            {processedPreviewError ? (
              <p className="mt-3 text-xs text-rose-600">Cleaned preview failed: {processedPreviewError}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {showDownloadButton ? (
              <button
                type="button"
                onClick={handleDownload}
                disabled={!canDownload}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-sky-700 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-sm"
              >
                {isDownloading ? "Downloading..." : "Download cleaned PDF"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleProcessAnother}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50"
            >
              Process another file
            </button>
          </div>

          {isInternalReviewVisible ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">Page feedback</p>
              <p className="mt-1 text-xs text-slate-600">
                Review every page before download. Complex diagrams or dense backgrounds may leave slight residue.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {FEEDBACK_OPTIONS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleFeedback(item.value)}
                    disabled={!canGiveFeedback}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <textarea
                value={feedbackNote}
                onChange={(event) => setFeedbackNote(event.target.value)}
                placeholder="Optional note for this page"
                className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-700"
                rows={2}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

async function readPdfPageCountFromFile(file: File): Promise<number> {
  const bytes = await file.arrayBuffer();
  return readPdfPageCountFromBytes(bytes);
}

async function readPdfPageCountFromUrl(url: string): Promise<number> {
  const bytes = await fetch(url).then((response) => response.arrayBuffer());
  return readPdfPageCountFromBytes(bytes);
}

async function readPdfPageCountFromBytes(data: ArrayBuffer): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data }).promise;
  const count = doc.numPages;
  await doc.destroy();
  return count;
}

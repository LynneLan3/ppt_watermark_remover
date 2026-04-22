"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { PdfExportControls } from "@/components/app/pdf-export-controls";
import { UploadDropzoneCard } from "@/components/app/upload-dropzone-card";
import { UploadPreviewWorkspace } from "@/components/app/upload-preview-workspace";
import type { UploadPageContent } from "@/content/pages/upload";
import type {
  CleanupScope,
  PdfCandidateAnalysisResult,
  PdfObjectCandidate,
} from "@/lib/local/pdf/types";

type UploadShellProps = {
  content: UploadPageContent;
};

type UploadFlowState =
  | "idle"
  | "uploading"
  | "analyzing"
  | "candidates_ready"
  | "no_candidates"
  | "unsupported_page"
  | "applying"
  | "completed"
  | "error";

type BackendPhase =
  | "idle"
  | "uploading"
  | "analyzing"
  | "analyzed"
  | "applying"
  | "completed"
  | "error";

type PreviewPhase =
  | "idle"
  | "loading_document"
  | "document_ready"
  | "rendering_page"
  | "preview_ready"
  | "analyzing_candidates"
  | "analysis_ready"
  | "error";

type BackendErrorCode =
  | "validation_error"
  | "unsupported_structure"
  | "no_candidates"
  | "runner_timeout"
  | "runner_crash"
  | "artifact_missing"
  | "cleanup_failed"
  | "internal_error";

type JobMeta = {
  jobId: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  deletionStatus: string;
  deletionPolicy: string;
  errorCode?: BackendErrorCode;
  errorMessage?: string;
};

type ApiResponse<T> = {
  success: boolean;
  status: string;
  message: string;
  errorCode?: BackendErrorCode;
  job?: JobMeta;
  data?: T;
};

type AnalyzeResponseData = {
  analysis: PythonAnalysisResponse;
  supportedCandidateCount?: number;
  unsupportedReasonBreakdown?: Record<string, number>;
  placementBreakdown?: Record<string, number>;
  recommendedCandidate?: {
    id: string;
    pageNumber: number;
    objectType: string;
    confidence: number;
    placementHint: string;
    reasonCode?: string;
    reason: string;
    recommendationLabel?: string;
  } | null;
  limitationHint?: string;
};

type RecommendedCandidate = NonNullable<
  NonNullable<AnalyzeResponseData["recommendedCandidate"]>
>;

const PLAN_SUPPORTED_OBJECT_TYPES = new Set<PdfObjectCandidate["objectType"]>([
  "text_run",
  "image_xobject",
]);

export function UploadShell({ content }: UploadShellProps) {
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [deletionPolicy, setDeletionPolicy] = useState<string | null>(null);
  const [backendPhase, setBackendPhase] = useState<BackendPhase>("idle");
  const [backendErrorCode, setBackendErrorCode] = useState<BackendErrorCode | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.1);
  const [previewPhase, setPreviewPhase] = useState<PreviewPhase>("idle");
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<PdfCandidateAnalysisResult | null>(null);
  const [recommendedCandidate, setRecommendedCandidate] = useState<RecommendedCandidate | null>(
    null,
  );
  const [unsupportedReasonBreakdown, setUnsupportedReasonBreakdown] = useState<Record<string, number>>({});
  const [analysisLimitationHint, setAnalysisLimitationHint] = useState<string | null>(null);
  const [scope, setScope] = useState<CleanupScope>("current");
  const [rangeStart, setRangeStart] = useState("1");
  const [rangeEnd, setRangeEnd] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [outputReady, setOutputReady] = useState(false);
  const [downloadedCleaned, setDownloadedCleaned] = useState(false);
  const [downloadedReport, setDownloadedReport] = useState(false);
  const [cleanupTriggered, setCleanupTriggered] = useState(false);
  const [fileSourceWarning, setFileSourceWarning] = useState<string | null>(null);

  const hasLoadedPdf = Boolean(fileBytes && pageCount > 0);

  const statusText = useMemo(() => {
    if (!fileBytes) {
      return "No PDF loaded";
    }
    if (pageCount <= 0) {
      if (
        previewPhase === "loading_document" ||
        previewPhase === "document_ready" ||
        previewPhase === "rendering_page"
      ) {
        return "Preparing preview...";
      }
      return "Page count pending";
    }
    return `Page ${currentPage} of ${pageCount}`;
  }, [fileBytes, currentPage, pageCount, previewPhase]);

  const rangeError = useMemo(() => {
    if (scope !== "range") {
      return null;
    }

    const start = Number.parseInt(rangeStart, 10);
    const end = Number.parseInt(rangeEnd, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return "Please enter a valid page range.";
    }
    if (pageCount > 0 && (start < 1 || end < 1 || start > pageCount || end > pageCount)) {
      return `Page range must be between 1 and ${pageCount}.`;
    }
    if (start > end) {
      return "Start page cannot be greater than end page.";
    }
    return null;
  }, [scope, rangeStart, rangeEnd, pageCount]);

  const currentPageCandidates = useMemo(
    () => (analysisResult ? analysisResult.candidatesByPage[currentPage] ?? [] : []),
    [analysisResult, currentPage],
  );

  const currentPageUnsupportedReason = useMemo(() => {
    const unsupported = currentPageCandidates.find(
      (candidate) => candidate.removability !== "supported",
    );
    if (!unsupported) {
      return null;
    }
    const code = unsupported.unsupportedReasonCode ?? unsupported.reasonCode;
    if (!code) {
      return unsupported.reasons[0] ?? null;
    }
    return mapUnsupportedReasonCodeToMessage(code);
  }, [currentPageCandidates]);

  const isNotebooklmLikeUpload = useMemo(() => {
    if (!fileName) {
      return false;
    }
    return fileName.toLowerCase().includes("notebooklm");
  }, [fileName]);

  const dominantUnsupportedReasonCode = useMemo(() => {
    const entries = Object.entries(unsupportedReasonBreakdown);
    if (entries.length <= 0) {
      return null;
    }
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? null;
  }, [unsupportedReasonBreakdown]);

  const unsupportedGuidance = useMemo(() => {
    const reasonCode =
      currentPageCandidates.find((candidate) => candidate.removability !== "supported")
        ?.unsupportedReasonCode ??
      currentPageCandidates.find((candidate) => candidate.removability !== "supported")
        ?.reasonCode ??
      dominantUnsupportedReasonCode;
    return reasonCode
      ? getUnsupportedGuidance(reasonCode, {
          notebooklmLikely: isNotebooklmLikeUpload,
          limitationHint: analysisLimitationHint,
        })
      : null;
  }, [
    currentPageCandidates,
    dominantUnsupportedReasonCode,
    isNotebooklmLikeUpload,
    analysisLimitationHint,
  ]);

  const selectedCandidate = useMemo(() => {
    if (!activeCandidateId) {
      return null;
    }
    return currentPageCandidates.find((candidate) => candidate.id === activeCandidateId) ?? null;
  }, [currentPageCandidates, activeCandidateId]);

  const supportedCandidatesOnCurrentPage = useMemo(
    () =>
      currentPageCandidates.filter(
        (candidate) =>
          PLAN_SUPPORTED_OBJECT_TYPES.has(candidate.objectType) &&
          candidate.removability === "supported",
      ),
    [currentPageCandidates],
  );

  const selectedCandidatePlanEligibility = useMemo(() => {
    if (backendPhase !== "analyzed" && backendPhase !== "completed") {
      return {
        allowed: false,
        reason: "后端分析尚未完成。",
      };
    }
    if (!selectedCandidate) {
      return {
        allowed: false,
        reason: "Please select a candidate before preview and cleanup.",
      };
    }
    if (!PLAN_SUPPORTED_OBJECT_TYPES.has(selectedCandidate.objectType)) {
      return {
        allowed: false,
        reason: `Object type "${selectedCandidate.objectType}" is not supported yet.`,
      };
    }
    if (selectedCandidate.removability !== "supported") {
      return {
        allowed: false,
        reason: "This candidate is not in supported status.",
      };
    }
    return {
      allowed: true,
      reason: null,
    };
  }, [backendPhase, selectedCandidate]);

  const isPreviewReady = useMemo(
    () =>
      pageCount > 0 &&
      (previewPhase === "preview_ready" ||
        previewPhase === "analysis_ready" ||
        previewPhase === "rendering_page"),
    [pageCount, previewPhase],
  );

  const flowState = useMemo<UploadFlowState>(() => {
    if (backendPhase === "uploading") {
      return "uploading";
    }
    if (backendPhase === "analyzing") {
      return "analyzing";
    }
    if (backendPhase === "applying") {
      return "applying";
    }
    if (backendPhase === "completed") {
      return "completed";
    }
    if (backendPhase === "error") {
      return "error";
    }
    if (!fileBytes) {
      return "idle";
    }
    if (!isPreviewReady) {
      return "analyzing";
    }
    if (!analysisResult) {
      return "analyzing";
    }
    if (supportedCandidatesOnCurrentPage.length > 0) {
      return "candidates_ready";
    }
    return analysisResult.unsupportedPages.includes(currentPage)
      ? "unsupported_page"
      : "no_candidates";
  }, [
    backendPhase,
    fileBytes,
    analysisResult,
    supportedCandidatesOnCurrentPage.length,
    currentPage,
    isPreviewReady,
  ]);

  const flowMessage = useMemo(() => {
    if (backendPhase === "uploading") {
      return "Uploading NotebookLM export to temporary upload...";
    }
    if (backendPhase === "analyzing") {
      return "Generating preview and analyzing watermark candidates...";
    }
    if (backendPhase === "applying") {
      return "Preview cleaned result before download.";
    }
    if (backendPhase === "completed") {
      if (cleanupTriggered) {
        return "Download cleaned file and report. Auto delete will follow policy.";
      }
      return "Download cleaned file.";
    }
    if (backendPhase === "error") {
      return error ?? mapErrorCodeToMessage(backendErrorCode);
    }
    if (!isPreviewReady) {
      return "Upload NotebookLM export file.";
    }
    if (flowState === "candidates_ready") {
      if (recommendedCandidate) {
        const label = recommendedCandidate.recommendationLabel ?? "Recommended Candidate";
        return `已推荐候选对象（${label} · ${Math.round(
          recommendedCandidate.confidence * 100,
        )}%），可直接确认移除。`;
      }
      return "File selected, click Generate preview.";
    }
    if (flowState === "unsupported_page") {
      return currentPageUnsupportedReason
        ? `Unsupported structure on this page: ${currentPageUnsupportedReason}`
        : "Unsupported structure on this page.";
    }
    if (flowState === "no_candidates") {
      return currentPageUnsupportedReason
        ? `No removable candidate found on this page: ${currentPageUnsupportedReason}`
        : "No removable candidate found on this page.";
    }
    return "Upload NotebookLM export file.";
  }, [
    backendPhase,
    error,
    flowState,
    cleanupTriggered,
    backendErrorCode,
    isPreviewReady,
    currentPageUnsupportedReason,
    recommendedCandidate,
  ]);

  const scopeSummary = useMemo(() => {
    if (scope === "current") {
      return `Current page (${currentPage})`;
    }
    if (scope === "all") {
      if (!selectedCandidate || !analysisResult) {
        return "全部重复实例";
      }
      const matchingPages = Object.entries(analysisResult.candidatesByPage).filter(
        ([, candidates]) =>
          candidates.some((candidate) => candidate.repeatKey === selectedCandidate.repeatKey),
      );
      return `All repeated instances (${matchingPages.length} pages)`;
    }
    return `Page range (${rangeStart || "?"} to ${rangeEnd || "?"})`;
  }, [scope, currentPage, rangeStart, rangeEnd, selectedCandidate, analysisResult]);

  const handleFileSelected = async (file: File) => {
    setError(null);
    setBackendErrorCode(null);
    setOutputReady(false);
    setDownloadedCleaned(false);
    setDownloadedReport(false);
    setCleanupTriggered(false);
    setAnalysisResult(null);
    setRecommendedCandidate(null);
    setUnsupportedReasonBreakdown({});
    setAnalysisLimitationHint(null);
    setActiveCandidateId(null);
    setCurrentPage(1);
    setRangeStart("1");
    setRangeEnd("1");
    setFileName(file.name);
    setFileSizeBytes(file.size);
    setFileSourceWarning(
      file.name.toLowerCase().endsWith(".cleaned.pdf")
        ? "This appears to be a processed output file. Use the original source PDF when possible."
        : null,
    );
    setPreviewPhase("loading_document");

    try {
      setFileBytes(await file.arrayBuffer());
      setBackendPhase("uploading");

      const form = new FormData();
      form.append("file", file);
      const uploadResp = await fetch("/api/temp-jobs/upload", {
        method: "POST",
        body: form,
      });
      const uploadJson = (await uploadResp.json()) as ApiResponse<{
        jobId: string;
        originalFilename: string;
      }>;
      if (!uploadResp.ok || !uploadJson.success || !uploadJson.job || !uploadJson.data?.jobId) {
        throw normalizeApiError(uploadJson);
      }

      setJobId(uploadJson.data.jobId);
      setExpiresAt(uploadJson.job.expiresAt);
      setDeletionPolicy(uploadJson.job.deletionPolicy);
      setBackendPhase("analyzing");

      const analyzeResp = await fetch(`/api/temp-jobs/${uploadJson.data.jobId}/analyze`, {
        method: "POST",
      });
      const analyzeJson = (await analyzeResp.json()) as ApiResponse<AnalyzeResponseData>;

      const maybeAnalysis = analyzeJson.data?.analysis;
      if (maybeAnalysis) {
        setAnalysisResult(normalizeAnalysisResult(maybeAnalysis));
      }
      setUnsupportedReasonBreakdown(analyzeJson.data?.unsupportedReasonBreakdown ?? {});
      setRecommendedCandidate((analyzeJson.data?.recommendedCandidate ?? null) as RecommendedCandidate | null);
      setAnalysisLimitationHint(analyzeJson.data?.limitationHint ?? null);

      const recommended = analyzeJson.data?.recommendedCandidate;
      if (recommended?.id) {
        setActiveCandidateId(recommended.id);
        if (Number.isInteger(recommended.pageNumber) && recommended.pageNumber > 0) {
          setCurrentPage(recommended.pageNumber);
        }
      }

      if (!analyzeResp.ok || !analyzeJson.success) {
        const code = analyzeJson.errorCode ?? "internal_error";
        if (code === "no_candidates" || code === "unsupported_structure") {
          setBackendPhase("analyzed");
          setBackendErrorCode(code);
          setError(analyzeJson.message);
          return;
        }
        throw normalizeApiError(analyzeJson);
      }

      setBackendPhase("analyzed");
    } catch (uploadError) {
      const normalized = normalizeClientError(uploadError);
      setBackendPhase("error");
      setBackendErrorCode(normalized.code);
      setError(normalized.message);
    }
  };

  const handleFileRejected = (message: string) => {
    setError(message);
    setBackendErrorCode("validation_error");
    setBackendPhase("error");
  };

  const handlePageCountChange = (count: number) => {
    setPageCount(count);
    setRangeEnd(String(Math.max(1, count)));
  };

  const handlePreviewLoadError = useCallback((message: string) => {
    setError(message);
    setBackendErrorCode("internal_error");
    setBackendPhase("error");
  }, []);

  const handlePreviewLoadSuccess = useCallback(() => {
    if (backendPhase !== "error") {
      setError(null);
      setBackendErrorCode(null);
    }
  }, [backendPhase]);

  const handleApplyRemoval = async () => {
    if (!jobId || !selectedCandidatePlanEligibility.allowed || rangeError || !hasLoadedPdf) {
      return;
    }
    try {
      setError(null);
      setBackendErrorCode(null);
      setBackendPhase("applying");
      setOutputReady(false);

      const applyResp = await fetch(`/api/temp-jobs/${jobId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          selectedCandidateId: selectedCandidate?.id,
          scope,
          currentPage,
          pageCount,
          rangeStart: scope === "range" ? Number.parseInt(rangeStart, 10) : undefined,
          rangeEnd: scope === "range" ? Number.parseInt(rangeEnd, 10) : undefined,
        }),
      });
      const applyJson = (await applyResp.json()) as ApiResponse<{ report: unknown }>;
      if (!applyResp.ok || !applyJson.success) {
        throw normalizeApiError(applyJson);
      }

      setOutputReady(true);
      setBackendPhase("completed");
    } catch (applyError) {
      const normalized = normalizeClientError(applyError);
      if (
        normalized.code === "unsupported_structure" ||
        normalized.code === "validation_error" ||
        normalized.code === "no_candidates"
      ) {
        setBackendPhase("analyzed");
      } else {
        setBackendPhase("error");
      }
      setBackendErrorCode(normalized.code);
      setError(normalized.message);
    }
  };

  const handleDownloadCleanedPdf = async () => {
    if (!jobId || !outputReady) {
      return;
    }
    const result = await downloadArtifact(jobId, "cleaned");
    if (!result.success) {
      setBackendErrorCode(result.errorCode);
      setError(result.message);
      if (result.errorCode === "artifact_missing") {
        setBackendPhase("error");
      }
      return;
    }
    setDownloadedCleaned(true);
    if (downloadedReport) {
      setCleanupTriggered(true);
    }
  };

  const handleDownloadReport = async () => {
    if (!jobId || !outputReady) {
      return;
    }
    const result = await downloadArtifact(jobId, "report");
    if (!result.success) {
      setBackendErrorCode(result.errorCode);
      setError(result.message);
      if (result.errorCode === "artifact_missing") {
        setBackendPhase("error");
      }
      return;
    }
    setDownloadedReport(true);
    if (downloadedCleaned) {
      setCleanupTriggered(true);
    }
  };

  return (
    <main className="bg-slate-100 px-6 py-10 sm:py-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:px-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
              {content.hero.title}
            </h1>
            <p className="mt-1 text-sm text-slate-600">{content.hero.description}</p>
          </div>
          <span className="inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
            {content.hero.badge}
          </span>
        </section>

        <section className="grid gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <UploadDropzoneCard
                content={content.toolPanel}
                fileName={fileName}
                fileSizeBytes={fileSizeBytes}
                onFileSelected={handleFileSelected}
                onFileRejected={handleFileRejected}
              />
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                <p>
                  <span className="font-semibold">Preview status:</span> {flowState}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Job ID:</span> {jobId ?? "not created"}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Temporary expiry:</span>{" "}
                  {expiresAt ? new Date(expiresAt).toLocaleString() : "pending"}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Auto delete policy:</span>{" "}
                  {deletionPolicy ?? "delete_after_both_downloads_or_expiry"}
                </p>
                <p className="mt-1">{flowMessage}</p>
                {fileSourceWarning ? (
                  <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
                    {fileSourceWarning}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <PdfExportControls
                scope={scope}
                onScopeChange={setScope}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                onRangeStartChange={setRangeStart}
                onRangeEndChange={setRangeEnd}
                rangeError={rangeError}
                pageCount={pageCount}
                currentPage={currentPage}
                selectedCandidate={selectedCandidate}
                scopeSummary={scopeSummary}
                analysisResult={analysisResult}
                error={error}
                disabled={!hasLoadedPdf}
                activeCandidateId={activeCandidateId}
                onSelectCandidate={setActiveCandidateId}
                flowState={flowState}
                flowMessage={flowMessage}
                currentPageSupportedCandidateCount={supportedCandidatesOnCurrentPage.length}
                selectedCandidatePlanEligibility={selectedCandidatePlanEligibility}
                onApplyRemoval={() => void handleApplyRemoval()}
                onDownloadCleanedPdf={() => void handleDownloadCleanedPdf()}
                onDownloadReport={() => void handleDownloadReport()}
                outputReady={outputReady}
                recommendedCandidate={recommendedCandidate}
                unsupportedGuidance={unsupportedGuidance}
              />
            </section>
          </div>

          <div className="lg:col-span-8">
            <UploadPreviewWorkspace
              content={content.placeholder}
              fileBytes={fileBytes}
              currentPage={currentPage}
              onCurrentPageChange={setCurrentPage}
              zoom={zoom}
              onZoomChange={setZoom}
              onPageCountChange={handlePageCountChange}
              statusText={statusText}
              activeCandidateId={activeCandidateId}
              onActiveCandidateChange={setActiveCandidateId}
              onCandidateAnalysisChange={setAnalysisResult}
              onLoadError={handlePreviewLoadError}
              onLoadSuccess={handlePreviewLoadSuccess}
              backendAnalysisResult={analysisResult}
              useBackendCandidates
              onPhaseChange={setPreviewPhase}
            />
          </div>
        </section>

        <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Trust and processing details
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-semibold text-slate-900">{content.trustSummary.title}</h2>
              <p className="mt-2 text-xs leading-5 text-slate-600">{content.trustSummary.intro}</p>
              <ul className="mt-3 space-y-2">
                {content.trustSummary.points.map((point) => (
                  <li
                    key={point}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700"
                  >
                    {point}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h2 className="text-sm font-semibold text-slate-900">{content.toolPanel.availabilityTitle}</h2>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {content.toolPanel.availabilityText}
              </p>
              <ul className="mt-2 space-y-2">
                {content.toolPanel.statusItems.map((item) => (
                  <li
                    key={item}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </details>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold text-slate-900 sm:text-2xl">{content.cta.title}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">{content.cta.description}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href={content.cta.links.contact.href}
              className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-800"
            >
              {content.cta.links.contact.label}
            </Link>
            <Link
              href={content.cta.links.privacy.href}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.cta.links.privacy.label}
            </Link>
            <Link
              href={content.cta.links.home.href}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              {content.cta.links.home.label}
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

type PythonAnalysisResponse = {
  totalCandidates: number;
  unsupportedPages: number[];
  notes: string[];
  candidatesByPage: Record<string, PdfObjectCandidate[]>;
};

function normalizeAnalysisResult(input: PythonAnalysisResponse): PdfCandidateAnalysisResult {
  const candidatesByPage: Record<number, PdfObjectCandidate[]> = {};
  for (const [page, candidates] of Object.entries(input.candidatesByPage ?? {})) {
    candidatesByPage[Number(page)] = candidates;
  }
  return {
    candidatesByPage,
    totalCandidates: input.totalCandidates ?? 0,
    unsupportedPages: input.unsupportedPages ?? [],
    notes: input.notes ?? [],
  };
}

function normalizeApiError(response: ApiResponse<unknown>): {
  code: BackendErrorCode;
  message: string;
} {
  return {
    code: response.errorCode ?? "internal_error",
    message: response.message || mapErrorCodeToMessage(response.errorCode ?? "internal_error"),
  };
}

function normalizeClientError(error: unknown): {
  code: BackendErrorCode;
  message: string;
} {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const typed = error as { code: BackendErrorCode; message: string };
    return typed;
  }
  if (error instanceof Error) {
    return {
      code: "internal_error",
      message: error.message,
    };
  }
  return {
    code: "internal_error",
    message: "处理失败，请稍后重试。",
  };
}

function mapErrorCodeToMessage(code: BackendErrorCode | null): string {
  if (code === "validation_error") {
    return "上传文件校验失败，请确认是有效 PDF 且大小在限制内。";
  }
  if (code === "unsupported_structure") {
    return "This file structure is currently unsupported for cleanup preview.";
  }
  if (code === "no_candidates") {
    return "No removable candidates found.";
  }
  if (code === "runner_timeout") {
    return "处理超时，请尝试更小文件或稍后重试。";
  }
  if (code === "runner_crash") {
    return "处理引擎执行失败，请重试。";
  }
  if (code === "artifact_missing") {
    return "任务文件已过期或已删除，无法继续下载。";
  }
  if (code === "cleanup_failed") {
    return "Cleanup after download failed. Auto delete will continue on expiry.";
  }
  return "发生内部错误，请稍后重试。";
}

function mapUnsupportedReasonCodeToMessage(code: string): string {
  if (code === "large_background_image") {
    return "检测到大面积背景图像，已拒绝移除。";
  }
  if (code === "likely_background_baked") {
    return "疑似背景烘焙结构，无法安全对象级移除。";
  }
  if (code === "non_repeated_decorative_image") {
    return "图像仅单页出现，缺乏重复性信号。";
  }
  if (code === "unsupported_structure") {
    return "结构不满足安全移除条件。";
  }
  return code;
}

function getUnsupportedGuidance(
  code: string,
  options: { notebooklmLikely: boolean; limitationHint: string | null },
): {
  title: string;
  detail: string;
  recommendation: string;
} {
  if (options.notebooklmLikely && options.limitationHint) {
    return {
      title: "NotebookLM 导出支持有限（实验性）",
      detail: options.limitationHint,
      recommendation:
        "Current object-level strategy works best for repeated, independent watermark-like objects.",
    };
  }
  if (code === "large_background_image") {
    return {
      title: "检测到整页/大面积背景图",
      detail: "该对象更可能是页面背景或主体内容，继续处理会有破坏风险。",
      recommendation: "Upload the original export when possible and prioritize independent object layers.",
    };
  }
  if (code === "likely_background_baked") {
    return {
      title: "疑似背景烘焙结构",
      detail: "品牌元素可能已经和页面背景合并，无法做安全对象级删除。",
      recommendation: "建议使用更早期导出版本，或确认导出设置保留独立对象层。",
    };
  }
  if (code === "non_repeated_decorative_image") {
    return {
      title: "检测到非重复装饰图像",
      detail: "This image appears only once and does not provide a stable repeated pattern.",
      recommendation: "Prioritize repeated candidates across pages for stable preview.",
    };
  }
  return {
    title: "结构暂不支持",
    detail: "Current file structure does not match supported object-level cleanup.",
    recommendation: "Commonly supported: repeated corner marks, repeated header text, repeated footer text.",
  };
}

async function downloadArtifact(
  jobId: string,
  artifact: "cleaned" | "report",
): Promise<{ success: true } | { success: false; errorCode: BackendErrorCode; message: string }> {
  const response = await fetch(`/api/temp-jobs/${jobId}/artifacts/${artifact}`);
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok || contentType.includes("application/json")) {
    const json = (await response.json().catch(() => null)) as ApiResponse<never> | null;
    const errorCode = json?.errorCode ?? "internal_error";
    return {
      success: false,
      errorCode,
      message: json?.message ?? mapErrorCodeToMessage(errorCode),
    };
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact === "cleaned" ? "cleaned.pdf" : "report.json";
  anchor.click();
  URL.revokeObjectURL(url);
  return { success: true };
}

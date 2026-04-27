"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

type ManualReviewPageClientProps = {
  algorithmProfile: string;
};

type UiStatus =
  | "idle"
  | "uploading"
  | "uploaded"
  | "rendering-preview"
  | "processing"
  | "completed"
  | "failed";

type ManualReviewApiResponse = {
  success: boolean;
  message: string;
  data?: ManualReviewJobData;
};

type ManualReviewJobData = {
  jobId: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  currentStage: "uploaded" | "processing" | "completed" | "failed";
  elapsedMs: number;
  algorithmProfile: string;
  enableSeamMicroPolish: boolean;
  originalFilename: string;
  fileSizeBytes: number;
  pageCount: number | null;
  errorSummary?: string;
  logsRelativePath: string;
  urls: {
    originalUrl: string;
    processedUrl: string;
    reportUrl: string;
    logsUrl: string;
  };
  debugArtifacts: Array<{
    name: string;
    relativePath: string;
    url: string;
  }>;
};

type ManualQaStatus =
  | "Pass"
  | "Minor Residue"
  | "Visible Residue"
  | "White Patch"
  | "Hard Edge"
  | "Text / Line Damage"
  | "Severe Fail";

type IssueTag =
  | "minor_residue"
  | "visible_residue"
  | "white_patch"
  | "hard_edge"
  | "text_line_damage"
  | "severe_fail";

type PageReviewEntry = {
  manualStatus: ManualQaStatus;
  issueTags: IssueTag[];
  note: string;
  updatedAt: string;
};

type PageReviewMap = Record<number, PageReviewEntry>;

type ProcessReportPayload = {
  perPageResults?: Array<Record<string, unknown>>;
  inputPageCount?: number;
  processedPageCount?: number;
};

type LocalQaRow = {
  jobId: string;
  pdfName: string;
  pageIndex: number;
  manualStatus: ManualQaStatus;
  issueTags: IssueTag[];
  note: string;
  algorithmProfile: string;
  processReportPerPage: Record<string, unknown> | null;
};

type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

type PdfDocument = {
  numPages: number;
  getPage: (page: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfLoadingTask = {
  promise: Promise<PdfDocument>;
  destroy: () => void;
};

type PdfModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (params: { data?: ArrayBuffer; url?: string }) => PdfLoadingTask;
};

type ServerQaSummary = {
  totalPages: number;
  passCount: number;
  failCount: number;
  passRate: number;
  residueCount: number;
  whitePatchCount: number;
  hardEdgeCount: number;
  damageCount: number;
  severeFailCount: number;
  overallPassRate: number;
  issueDistribution: Record<string, number>;
  failedPages: Array<{ pageIndex: number; manualStatus: ManualQaStatus; issueTags: string[]; note: string }>;
  topIssueType: string;
  recommendedNextOptimizationTarget: string;
};

type ServerQaExportResponse = {
  success: boolean;
  message: string;
  data?: {
    qaDatasetUrl: string;
    qaSummaryUrl: string;
    summary: ServerQaSummary;
  };
};

const STATUS_ITEMS: UiStatus[] = [
  "idle",
  "uploading",
  "uploaded",
  "rendering-preview",
  "processing",
  "completed",
  "failed",
];

const MANUAL_STATUS_OPTIONS: ManualQaStatus[] = [
  "Pass",
  "Minor Residue",
  "Visible Residue",
  "White Patch",
  "Hard Edge",
  "Text / Line Damage",
  "Severe Fail",
];

const ISSUE_TAG_OPTIONS: Array<{ value: IssueTag; label: string }> = [
  { value: "minor_residue", label: "Minor Residue" },
  { value: "visible_residue", label: "Visible Residue" },
  { value: "white_patch", label: "White Patch" },
  { value: "hard_edge", label: "Hard Edge" },
  { value: "text_line_damage", label: "Text / Line Damage" },
  { value: "severe_fail", label: "Severe Fail" },
];

export function ManualReviewPageClient({ algorithmProfile }: ManualReviewPageClientProps) {
  const [status, setStatus] = useState<UiStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePageCount, setSelectedFilePageCount] = useState<number | null>(null);
  const [job, setJob] = useState<ManualReviewJobData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.25);
  const [previewFailed, setPreviewFailed] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [reviews, setReviews] = useState<PageReviewMap>({});
  const [processReportByPage, setProcessReportByPage] = useState<Map<number, Record<string, unknown>>>(new Map());
  const [exportingQa, setExportingQa] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<{ qaDatasetUrl: string; qaSummaryUrl: string; summary: ServerQaSummary } | null>(null);

  const pollTokenRef = useRef(0);
  const activeJobIdRef = useRef<string | null>(null);

  const pageCount = useMemo(() => {
    if (job?.pageCount && job.pageCount > 0) {
      return job.pageCount;
    }
    if (selectedFilePageCount && selectedFilePageCount > 0) {
      return selectedFilePageCount;
    }
    return 1;
  }, [job?.pageCount, selectedFilePageCount]);

  const currentReview = reviews[currentPage] ?? defaultReviewEntry();

  const formattedElapsed = useMemo(() => {
    if (!job) {
      return "0.0s";
    }
    return `${(job.elapsedMs / 1000).toFixed(1)}s`;
  }, [job]);

  useEffect(() => {
    return () => {
      pollTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!job?.jobId) {
      return;
    }
    window.localStorage.setItem(localStorageKey(job.jobId), JSON.stringify(reviews));
  }, [reviews, job?.jobId]);

  useEffect(() => {
    if (!job?.jobId || job.status !== "completed") {
      return;
    }
    void (async () => {
      try {
        const response = await fetch(job.urls.reportUrl, { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        const report = (await response.json()) as ProcessReportPayload;
        const map = new Map<number, Record<string, unknown>>();
        for (const row of report.perPageResults || []) {
          const pageIndex = Number(row.page);
          if (!Number.isInteger(pageIndex) || pageIndex <= 0) {
            continue;
          }
          map.set(pageIndex, row);
        }
        setProcessReportByPage(map);
      } catch {
        setProcessReportByPage(new Map());
      }
    })();
  }, [job?.jobId, job?.status, job?.urls.reportUrl]);

  const stats = useMemo(() => buildStats(pageCount, reviews), [pageCount, reviews]);

  const applyJobUpdate = useCallback((nextJob: ManualReviewJobData) => {
    const previousJobId = activeJobIdRef.current;
    if (previousJobId !== nextJob.jobId) {
      activeJobIdRef.current = nextJob.jobId;
      setReviews(loadReviews(nextJob.jobId));
      setCurrentPage(1);
      setExportResult(null);
      setProcessReportByPage(new Map());
    }
    setJob(nextJob);
  }, []);

  const updateCurrentReview = (next: Partial<PageReviewEntry>) => {
    setReviews((prev) => {
      const base = prev[currentPage] ?? defaultReviewEntry();
      const merged: PageReviewEntry = {
        ...base,
        ...next,
        updatedAt: new Date().toISOString(),
      };
      return {
        ...prev,
        [currentPage]: merged,
      };
    });
  };

  const toggleIssueTag = (tag: IssueTag) => {
    setReviews((prev) => {
      const base = prev[currentPage] ?? defaultReviewEntry();
      const has = base.issueTags.includes(tag);
      const issueTags = has ? base.issueTags.filter((item) => item !== tag) : [...base.issueTags, tag];
      return {
        ...prev,
        [currentPage]: {
          ...base,
          issueTags,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const pollJobUntilTerminal = useCallback(
    async (jobId: string, token: number) => {
      while (token === pollTokenRef.current) {
        const response = await fetch(`/api/manual-review/jobs/${encodeURIComponent(jobId)}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as ManualReviewApiResponse;

        if (!response.ok || !payload.success || !payload.data) {
          throw new Error(payload.message || "job polling failed");
        }

        const nextJob = payload.data;
        applyJobUpdate(nextJob);

        if (nextJob.status === "failed") {
          setStatus("failed");
          setErrorMessage(nextJob.errorSummary || "processing failed");
          return;
        }

        if (nextJob.status === "completed") {
          setStatus(previewReady ? "completed" : "rendering-preview");
          return;
        }

        setStatus(nextJob.status === "uploaded" ? "uploaded" : "processing");
        await sleep(1200);
      }
    },
    [applyJobUpdate, previewReady],
  );

  const startUpload = useCallback(
    async (file: File) => {
      pollTokenRef.current += 1;
      const token = pollTokenRef.current;
      setErrorMessage(null);
      setPreviewFailed(null);
      setPreviewReady(false);
      setStatus("uploading");
      setExportProgress(null);

      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/manual-review/jobs", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as ManualReviewApiResponse;
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "upload failed");
      }

      const created = payload.data;
      applyJobUpdate(created);
      if (created.status === "failed") {
        setStatus("failed");
        setErrorMessage(created.errorSummary || "processing failed");
        return;
      }

      if (created.status === "completed") {
        setStatus("rendering-preview");
        return;
      }

      setStatus(created.status === "uploaded" ? "uploaded" : "processing");
      await pollJobUntilTerminal(created.jobId, token);
    },
    [applyJobUpdate, pollJobUntilTerminal],
  );

  const handleFileChange = async (file: File | null) => {
    if (!file) {
      return;
    }
    setSelectedFile(file);
    setSelectedFilePageCount(await getPdfPageCount(file).catch(() => null));

    try {
      await startUpload(file);
    } catch (error) {
      setStatus("failed");
      setErrorMessage(error instanceof Error ? error.message : "upload failed");
    }
  };

  const exportLocalQaJson = () => {
    if (!job) {
      setErrorMessage("No active job.");
      return;
    }
    const rows = buildQaRows({
      job,
      pageCount,
      reviews,
      processReportByPage,
      pdfName: selectedFile?.name || job.originalFilename,
    });
    const payload = {
      exportedAt: new Date().toISOString(),
      jobId: job.jobId,
      pdfName: selectedFile?.name || job.originalFilename,
      algorithmProfile: job.algorithmProfile,
      rows,
    };
    downloadJson(`${job.jobId}.manual-qa.json`, payload);
  };

  const exportServerQa = async () => {
    if (!job || job.status !== "completed") {
      setErrorMessage("Job is not completed yet.");
      return;
    }
    setExportingQa(true);
    setErrorMessage(null);
    setExportProgress("Preparing page screenshots...");

    try {
      const artifacts = await captureAllPageArtifacts({
        originalUrl: job.urls.originalUrl,
        processedUrl: job.urls.processedUrl,
        pageCount,
        onProgress: (text) => setExportProgress(text),
      });

      for (const page of artifacts) {
        setExportProgress(`Uploading artifacts page ${page.pageIndex}/${pageCount}...`);
        await fetch(`/api/manual-review/jobs/${encodeURIComponent(job.jobId)}/qa/artifacts`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(page),
        });
      }

      setExportProgress("Building QA summary...");
      const rows = buildQaRows({
        job,
        pageCount,
        reviews,
        processReportByPage,
        pdfName: selectedFile?.name || job.originalFilename,
      });

      const summaryResp = await fetch(`/api/manual-review/jobs/${encodeURIComponent(job.jobId)}/qa/summary`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          pdfName: selectedFile?.name || job.originalFilename,
          algorithmProfile: job.algorithmProfile,
          pageReviews: rows.map((row) => ({
            pageIndex: row.pageIndex,
            manualStatus: row.manualStatus,
            issueTags: row.issueTags,
            note: row.note,
          })),
        }),
      });
      const payload = (await summaryResp.json()) as ServerQaExportResponse;
      if (!summaryResp.ok || !payload.success || !payload.data) {
        throw new Error(payload.message || "qa summary export failed");
      }

      setExportResult(payload.data);
      setExportProgress("QA dataset + summary exported.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "QA export failed");
      setExportProgress(null);
    } finally {
      setExportingQa(false);
    }
  };

  const reviewedCount = Object.keys(reviews).length;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900">Manual Review (Internal)</h1>
        <p className="text-sm text-slate-600">
          Upload a NotebookLM PDF, compare before/after, tag each page issue type, and export page-level QA dataset.
        </p>
        <p className="text-sm text-slate-700">
          Algorithm profile: <span className="font-semibold">{job?.algorithmProfile || algorithmProfile}</span>
          {" · "}
          V6 micro polish: <span className="font-semibold">{job?.enableSeamMicroPolish ? "ON" : "OFF"}</span>
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">QA Stats</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700 sm:grid-cols-5">
          <StatChip label="total pages" value={stats.totalPages} />
          <StatChip label="pass count" value={stats.passCount} />
          <StatChip label="fail count" value={stats.failCount} />
          <StatChip label="pass rate" value={`${(stats.passRate * 100).toFixed(1)}%`} />
          <StatChip label="residue count" value={stats.residueCount} />
          <StatChip label="white patch count" value={stats.whitePatchCount} />
          <StatChip label="hard edge count" value={stats.hardEdgeCount} />
          <StatChip label="damage count" value={stats.damageCount} />
          <StatChip label="severe fail count" value={stats.severeFailCount} />
          <StatChip label="reviewed" value={`${reviewedCount}/${pageCount}`} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">1. PDF 上传区</h2>
        <p className="mt-1 text-sm text-slate-600">选择单个 PDF 后自动处理。</p>
        <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 p-4 hover:border-slate-400">
          <span className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white">Select PDF</span>
          <span className="text-sm text-slate-600">{selectedFile ? selectedFile.name : "No file selected"}</span>
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleFileChange(file);
            }}
          />
        </label>
        {selectedFile ? (
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-3">
            <p>File: <span className="font-medium">{selectedFile.name}</span></p>
            <p>Size: <span className="font-medium">{formatFileSize(selectedFile.size)}</span></p>
            <p>Pages: <span className="font-medium">{selectedFilePageCount ?? "parsing..."}</span></p>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">2. 处理状态区</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_ITEMS.map((item) => (
            <span
              key={item}
              className={`rounded-full px-3 py-1 text-xs font-medium ${status === item ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {item}
            </span>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-700 sm:grid-cols-2">
          <p>jobId: <span className="font-mono">{job?.jobId || "-"}</span></p>
          <p>当前阶段: <span className="font-medium">{job?.currentStage || status}</span></p>
          <p>已耗时: <span className="font-medium">{formattedElapsed}</span></p>
          <p>日志路径: <span className="font-mono">{job?.logsRelativePath || "-"}</span></p>
        </div>
        {errorMessage ? <p className="mt-3 text-sm text-rose-600">错误摘要: {errorMessage}</p> : null}
        {exportProgress ? <p className="mt-2 text-sm text-slate-600">{exportProgress}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">3-4. 预览区 + 缩略图导航</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1}
          >
            Previous
          </button>
          <span className="text-sm text-slate-700">Page {currentPage} / {pageCount}</span>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
            onClick={() => setCurrentPage((prev) => Math.min(pageCount, prev + 1))}
            disabled={currentPage >= pageCount}
          >
            Next
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 disabled:opacity-50"
            onClick={() => setZoom((prev) => Math.max(0.6, round2(prev - 0.1)))}
            disabled={zoom <= 0.6}
          >
            Zoom -
          </button>
          <span className="text-sm text-slate-700">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700"
            onClick={() => setZoom((prev) => Math.min(2.5, round2(prev + 0.1)))}
          >
            Zoom +
          </button>
        </div>

        <PdfComparePreview
          originalUrl={job?.urls.originalUrl || null}
          processedUrl={job?.urls.processedUrl || null}
          page={currentPage}
          zoom={zoom}
          processingCompleted={job?.status === "completed"}
          onPreviewReady={() => {
            setPreviewReady(true);
            setStatus((prev) => (prev === "rendering-preview" ? "completed" : prev));
          }}
          onPreviewFailed={(message) => {
            setPreviewFailed(message);
            setStatus((prev) => (prev === "failed" ? prev : "completed"));
          }}
          onPageCount={(count) => {
            setJob((prev) => (prev ? { ...prev, pageCount: count } : prev));
            setCurrentPage((prev) => Math.min(Math.max(1, prev), Math.max(1, count)));
          }}
          onSelectPage={(page) => setCurrentPage(page)}
        />

        {previewFailed ? <p className="mt-3 text-sm text-rose-600">preview failed: {previewFailed}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">6. 人工验收区</h2>
        <p className="mt-1 text-sm text-slate-600">当前页：{currentPage}</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {MANUAL_STATUS_OPTIONS.map((item) => (
            <label key={item} className="rounded border border-slate-200 p-3 text-sm">
              <input
                type="radio"
                name="manual-status"
                checked={currentReview.manualStatus === item}
                onChange={() => updateCurrentReview({ manualStatus: item })}
              />{" "}
              {item}
            </label>
          ))}
        </div>

        <p className="mt-3 text-sm font-medium text-slate-800">Issue tags</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ISSUE_TAG_OPTIONS.map((tag) => (
            <label key={tag.value} className="rounded border border-slate-200 p-3 text-sm">
              <input
                type="checkbox"
                checked={currentReview.issueTags.includes(tag.value)}
                onChange={() => toggleIssueTag(tag.value)}
              />{" "}
              {tag.label}
            </label>
          ))}
        </div>

        <textarea
          className="mt-3 w-full rounded border border-slate-300 p-2 text-sm"
          rows={4}
          placeholder="right bottom residue visible / white patch / line damaged / text blurred / acceptable"
          value={currentReview.note}
          onChange={(event) => updateCurrentReview({ note: event.target.value })}
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">5. 下载区与 QA 导出</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <DownloadButton href={job?.urls.processedUrl} label="Download processed.pdf" disabled={job?.status !== "completed"} />
          <DownloadButton href={job?.urls.reportUrl} label="Download process-report.json" disabled={job?.status !== "completed"} />
          <DownloadButton href={job?.urls.logsUrl} label="Download logs.txt" disabled={!job} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
            onClick={exportLocalQaJson}
            disabled={!job}
          >
            Export QA JSON (local)
          </button>
          <button
            type="button"
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
            onClick={() => {
              void exportServerQa();
            }}
            disabled={!job || job.status !== "completed" || exportingQa}
          >
            {exportingQa ? "Exporting QA..." : "Export QA + Artifacts + Summary"}
          </button>
        </div>

        {exportResult ? (
          <div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p>QA summary exported.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <a className="rounded border border-emerald-300 bg-white px-3 py-1" href={exportResult.qaDatasetUrl}>Download qa-dataset.json</a>
              <a className="rounded border border-emerald-300 bg-white px-3 py-1" href={exportResult.qaSummaryUrl}>Download qa-summary.json</a>
            </div>
            <p className="mt-2">Top issue: <span className="font-semibold">{exportResult.summary.topIssueType}</span></p>
            <p>Recommendation: {exportResult.summary.recommendedNextOptimizationTarget}</p>
          </div>
        ) : null}

        {job?.debugArtifacts?.length ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-slate-800">Debug artifacts</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {job.debugArtifacts.map((artifact) => (
                <a
                  key={artifact.relativePath}
                  href={artifact.url}
                  className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {artifact.name}
                </a>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No debug artifacts found yet.</p>
        )}
      </section>
    </div>
  );
}

type PdfComparePreviewProps = {
  originalUrl: string | null;
  processedUrl: string | null;
  page: number;
  zoom: number;
  processingCompleted: boolean;
  onPreviewReady: () => void;
  onPreviewFailed: (message: string) => void;
  onPageCount: (count: number) => void;
  onSelectPage: (page: number) => void;
};

function PdfComparePreview({
  originalUrl,
  processedUrl,
  page,
  zoom,
  processingCompleted,
  onPreviewReady,
  onPreviewFailed,
  onPageCount,
  onSelectPage,
}: PdfComparePreviewProps) {
  const [docs, setDocs] = useState<{ original: PdfDocument | null; processed: PdfDocument | null }>({
    original: null,
    processed: null,
  });
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [thumbnailUrls, setThumbnailUrls] = useState<string[]>([]);

  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const processedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let originalTask: PdfLoadingTask | null = null;
    let processedTask: PdfLoadingTask | null = null;

    async function loadDocs() {
      if (!originalUrl || !processedUrl || !processingCompleted) {
        setDocs({ original: null, processed: null });
        setThumbnailUrls([]);
        return;
      }

      setIsLoadingDocs(true);
      try {
        const pdfjs = await loadPdfJs();
        const originalLoadingTask = pdfjs.getDocument({ url: originalUrl });
        const processedLoadingTask = pdfjs.getDocument({ url: processedUrl });
        originalTask = originalLoadingTask;
        processedTask = processedLoadingTask;
        const [originalDoc, processedDoc] = await Promise.all([
          originalLoadingTask.promise,
          processedLoadingTask.promise,
        ]);

        if (cancelled) {
          await Promise.all([originalDoc.destroy(), processedDoc.destroy()]);
          return;
        }

        setDocs({ original: originalDoc, processed: processedDoc });
        const pages = Math.max(1, Math.min(originalDoc.numPages || 1, processedDoc.numPages || 1));
        onPageCount(pages);
        const thumbs = await buildThumbnailUrls(originalDoc, pages);
        if (!cancelled) {
          setThumbnailUrls(thumbs);
          onPreviewReady();
        }
      } catch (error) {
        if (!cancelled) {
          onPreviewFailed(error instanceof Error ? error.message : "preview load failed");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingDocs(false);
        }
      }
    }

    void loadDocs();

    return () => {
      cancelled = true;
      originalTask?.destroy();
      processedTask?.destroy();
    };
  }, [onPageCount, onPreviewFailed, onPreviewReady, originalUrl, processedUrl, processingCompleted]);

  useEffect(() => {
    let cancelled = false;

    async function renderPair() {
      if (!docs.original || !docs.processed) {
        return;
      }
      const safePage = Math.max(1, Math.min(page, docs.original.numPages || 1, docs.processed.numPages || 1));
      try {
        await Promise.all([
          renderPdfPageToCanvas(docs.original, safePage, zoom, originalCanvasRef.current),
          renderPdfPageToCanvas(docs.processed, safePage, zoom, processedCanvasRef.current),
        ]);
      } catch (error) {
        if (!cancelled) {
          onPreviewFailed(error instanceof Error ? error.message : "render failed");
        }
      }
    }

    void renderPair();
    return () => {
      cancelled = true;
    };
  }, [docs.original, docs.processed, onPreviewFailed, page, zoom]);

  return (
    <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_240px]">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PdfCanvasCard title="original.pdf" canvasRef={originalCanvasRef} isLoading={isLoadingDocs} />
        <PdfCanvasCard title="processed.pdf" canvasRef={processedCanvasRef} isLoading={isLoadingDocs} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-medium text-slate-800">Thumbnails</p>
        <div className="grid max-h-[520px] grid-cols-4 gap-2 overflow-auto sm:grid-cols-6 xl:grid-cols-2">
          {thumbnailUrls.map((src, index) => {
            const pageNumber = index + 1;
            const active = pageNumber === page;
            return (
              <button
                key={pageNumber}
                type="button"
                className={`rounded border p-1 text-left ${active ? "border-slate-900 bg-white" : "border-slate-300 bg-white"}`}
                onClick={() => onSelectPage(pageNumber)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Page ${pageNumber}`} className="h-auto w-full" />
                <span className="mt-1 block text-center text-xs text-slate-600">p{pageNumber}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PdfCanvasCard({
  title,
  canvasRef,
  isLoading,
}: {
  title: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isLoading: boolean;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-sm font-medium text-slate-800">{title}</p>
      {isLoading ? <p className="mb-2 text-xs text-slate-500">Rendering preview...</p> : null}
      <div className="overflow-auto rounded border border-slate-200 bg-white p-2">
        <canvas ref={canvasRef} className="mx-auto block h-auto max-w-full" />
      </div>
    </article>
  );
}

function StatChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 p-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

async function loadPdfJs(): Promise<PdfModule> {
  const pdfjs = (await import("pdfjs-dist")) as unknown as PdfModule;
  pdfjs.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  return pdfjs;
}

async function renderPdfPageToCanvas(
  doc: PdfDocument,
  pageNumber: number,
  zoom: number,
  canvas: HTMLCanvasElement | null,
): Promise<void> {
  if (!canvas) {
    return;
  }
  const target = await doc.getPage(pageNumber);
  const viewport = target.getViewport({ scale: zoom });
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const renderTask = target.render({
    canvasContext: context,
    viewport,
  });
  await renderTask.promise;
}

async function buildThumbnailUrls(doc: PdfDocument, pageCount: number): Promise<string[]> {
  const limit = Math.max(1, pageCount);
  const urls: string[] = [];
  for (let page = 1; page <= limit; page += 1) {
    const pdfPage = await doc.getPage(page);
    const viewport = pdfPage.getViewport({ scale: 0.2 });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      continue;
    }
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const renderTask = pdfPage.render({
      canvasContext: ctx,
      viewport,
    });
    await renderTask.promise;
    urls.push(canvas.toDataURL("image/png"));
  }
  return urls;
}

function formatFileSize(size: number): string {
  const mb = size / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(2)} MB`;
  }
  const kb = size / 1024;
  return `${kb.toFixed(0)} KB`;
}

function localStorageKey(jobId: string): string {
  return `manual-review:${jobId}:page-qa:v2`;
}

function loadReviews(jobId: string): PageReviewMap {
  try {
    const raw = window.localStorage.getItem(localStorageKey(jobId));
    if (!raw) {
      return {};
    }
    return (JSON.parse(raw) as PageReviewMap) || {};
  } catch {
    return {};
  }
}

function defaultReviewEntry(): PageReviewEntry {
  return {
    manualStatus: "Pass",
    issueTags: [],
    note: "",
    updatedAt: new Date().toISOString(),
  };
}

async function getPdfPageCount(file: File): Promise<number> {
  const pdfjs = await loadPdfJs();
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  const count = Number(doc.numPages || 0);
  await doc.destroy();
  return count > 0 ? count : 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildStats(totalPages: number, reviews: PageReviewMap) {
  let passCount = 0;
  let failCount = 0;
  let residueCount = 0;
  let whitePatchCount = 0;
  let hardEdgeCount = 0;
  let damageCount = 0;
  let severeFailCount = 0;

  for (const entry of Object.values(reviews)) {
    if (entry.manualStatus === "Pass") {
      passCount += 1;
    } else {
      failCount += 1;
    }

    if (
      entry.manualStatus === "Minor Residue" ||
      entry.manualStatus === "Visible Residue" ||
      entry.issueTags.includes("minor_residue") ||
      entry.issueTags.includes("visible_residue")
    ) {
      residueCount += 1;
    }
    if (entry.manualStatus === "White Patch" || entry.issueTags.includes("white_patch")) {
      whitePatchCount += 1;
    }
    if (entry.manualStatus === "Hard Edge" || entry.issueTags.includes("hard_edge")) {
      hardEdgeCount += 1;
    }
    if (entry.manualStatus === "Text / Line Damage" || entry.issueTags.includes("text_line_damage")) {
      damageCount += 1;
    }
    if (entry.manualStatus === "Severe Fail" || entry.issueTags.includes("severe_fail")) {
      severeFailCount += 1;
    }
  }

  const passRate = totalPages > 0 ? passCount / totalPages : 0;
  return {
    totalPages,
    passCount,
    failCount,
    passRate,
    residueCount,
    whitePatchCount,
    hardEdgeCount,
    damageCount,
    severeFailCount,
  };
}

function buildQaRows(params: {
  job: ManualReviewJobData;
  pageCount: number;
  reviews: PageReviewMap;
  processReportByPage: Map<number, Record<string, unknown>>;
  pdfName: string;
}): LocalQaRow[] {
  const rows: LocalQaRow[] = [];
  for (let pageIndex = 1; pageIndex <= params.pageCount; pageIndex += 1) {
    const review = params.reviews[pageIndex] ?? defaultReviewEntry();
    rows.push({
      jobId: params.job.jobId,
      pdfName: params.pdfName,
      pageIndex,
      manualStatus: review.manualStatus,
      issueTags: review.issueTags,
      note: review.note,
      algorithmProfile: params.job.algorithmProfile,
      processReportPerPage: params.processReportByPage.get(pageIndex) ?? null,
    });
  }
  return rows;
}

function downloadJson(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function captureAllPageArtifacts(params: {
  originalUrl: string;
  processedUrl: string;
  pageCount: number;
  onProgress: (text: string) => void;
}): Promise<
  Array<{
    pageIndex: number;
    originalPageScreenshotDataUrl: string;
    processedPageScreenshotDataUrl: string;
    originalBottomRightCropDataUrl: string;
    processedBottomRightCropDataUrl: string;
  }>
> {
  const pdfjs = await loadPdfJs();
  const originalTask = pdfjs.getDocument({ url: params.originalUrl });
  const processedTask = pdfjs.getDocument({ url: params.processedUrl });

  const [originalDoc, processedDoc] = await Promise.all([originalTask.promise, processedTask.promise]);
  const total = Math.max(1, Math.min(params.pageCount, originalDoc.numPages, processedDoc.numPages));
  const output: Array<{
    pageIndex: number;
    originalPageScreenshotDataUrl: string;
    processedPageScreenshotDataUrl: string;
    originalBottomRightCropDataUrl: string;
    processedBottomRightCropDataUrl: string;
  }> = [];

  try {
    for (let pageIndex = 1; pageIndex <= total; pageIndex += 1) {
      params.onProgress(`Capturing page ${pageIndex}/${total}...`);
      const originalPage = await originalDoc.getPage(pageIndex);
      const processedPage = await processedDoc.getPage(pageIndex);

      const originalCanvas = await renderPageToDataCanvas(originalPage, 1.2);
      const processedCanvas = await renderPageToDataCanvas(processedPage, 1.2);

      output.push({
        pageIndex,
        originalPageScreenshotDataUrl: originalCanvas.toDataURL("image/png"),
        processedPageScreenshotDataUrl: processedCanvas.toDataURL("image/png"),
        originalBottomRightCropDataUrl: cropBottomRight(originalCanvas).toDataURL("image/png"),
        processedBottomRightCropDataUrl: cropBottomRight(processedCanvas).toDataURL("image/png"),
      });
    }
  } finally {
    await Promise.all([originalDoc.destroy(), processedDoc.destroy()]);
  }

  return output;
}

async function renderPageToDataCanvas(page: PdfPage, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas context unavailable");
  }
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({
    canvasContext: context,
    viewport,
  });
  await task.promise;
  return canvas;
}

function cropBottomRight(source: HTMLCanvasElement): HTMLCanvasElement {
  const cropWidth = Math.max(80, Math.floor(source.width * 0.28));
  const cropHeight = Math.max(60, Math.floor(source.height * 0.2));
  const sx = Math.max(0, source.width - cropWidth);
  const sy = Math.max(0, source.height - cropHeight);

  const crop = document.createElement("canvas");
  crop.width = cropWidth;
  crop.height = cropHeight;
  const context = crop.getContext("2d");
  if (!context) {
    return crop;
  }
  context.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return crop;
}

function DownloadButton({
  href,
  label,
  disabled,
}: {
  href: string | undefined;
  label: string;
  disabled: boolean;
}) {
  if (disabled || !href) {
    return (
      <span className="cursor-not-allowed rounded border border-slate-200 px-3 py-1 text-sm text-slate-400">
        {label}
      </span>
    );
  }

  return (
    <a
      href={href}
      className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
      download
    >
      {label}
    </a>
  );
}

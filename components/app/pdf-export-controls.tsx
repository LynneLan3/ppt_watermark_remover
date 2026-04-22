"use client";

import { useMemo } from "react";

import type {
  CleanupScope,
  PdfCandidateAnalysisResult,
  PdfObjectCandidate,
} from "@/lib/local/pdf/types";

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

type PdfExportControlsProps = {
  scope: CleanupScope;
  onScopeChange: (scope: CleanupScope) => void;
  rangeStart: string;
  rangeEnd: string;
  onRangeStartChange: (value: string) => void;
  onRangeEndChange: (value: string) => void;
  rangeError: string | null;
  pageCount: number;
  currentPage: number;
  selectedCandidate: PdfObjectCandidate | null;
  scopeSummary: string;
  analysisResult: PdfCandidateAnalysisResult | null;
  error: string | null;
  disabled: boolean;
  activeCandidateId: string | null;
  onSelectCandidate: (candidateId: string | null) => void;
  flowState: UploadFlowState;
  flowMessage: string;
  currentPageSupportedCandidateCount: number;
  selectedCandidatePlanEligibility: {
    allowed: boolean;
    reason: string | null;
  };
  onApplyRemoval: () => void;
  onDownloadCleanedPdf: () => void;
  onDownloadReport: () => void;
  outputReady: boolean;
  recommendedCandidate: {
    id: string;
    pageNumber: number;
    objectType: string;
    confidence: number;
    placementHint: string;
    reasonCode?: string;
    reason: string;
    recommendationLabel?: string;
  } | null;
  unsupportedGuidance: {
    title: string;
    detail: string;
    recommendation: string;
  } | null;
};

const FLOW_STEPS: UploadFlowState[] = [
  "idle",
  "uploading",
  "analyzing",
  "candidates_ready",
  "no_candidates",
  "unsupported_page",
  "applying",
  "completed",
  "error",
];

const FLOW_LABEL: Record<UploadFlowState, string> = {
  idle: "upload_pending",
  uploading: "uploading",
  analyzing: "preview_preparing",
  candidates_ready: "preview_ready",
  no_candidates: "no_candidates",
  unsupported_page: "unsupported_structure",
  applying: "confirming_cleanup",
  completed: "download_ready",
  error: "error",
};

const FLOW_PLACEHOLDER_COPY: Record<
  UploadFlowState,
  {
    title: string;
    description: string;
    tone: "slate" | "sky" | "amber" | "rose" | "emerald";
  }
> = {
  idle: {
    title: "Upload NotebookLM export file",
    description: "Select a NotebookLM export to start preview.",
    tone: "slate",
  },
  uploading: {
    title: "Uploading NotebookLM export",
    description: "Temporary upload is in progress.",
    tone: "sky",
  },
  analyzing: {
    title: "Preview cleaned result",
    description: "Generating preview for review before download.",
    tone: "sky",
  },
  candidates_ready: {
    title: "Preview cleaned result",
    description: "Review candidates and confirm cleanup scope.",
    tone: "sky",
  },
  no_candidates: {
    title: "No removable candidate found",
    description: "Try another page or upload a different NotebookLM export.",
    tone: "amber",
  },
  unsupported_page: {
    title: "Unsupported structure",
    description: "This page is blocked because structure is unsupported.",
    tone: "amber",
  },
  applying: {
    title: "Preview cleaned result",
    description: "Confirming cleanup details before download.",
    tone: "sky",
  },
  completed: {
    title: "Download cleaned file",
    description: "Preview is confirmed. Download cleaned file now.",
    tone: "emerald",
  },
  error: {
    title: "Upload and preview failed",
    description: "Please upload NotebookLM export again.",
    tone: "rose",
  },
};

export function PdfExportControls({
  scope,
  onScopeChange,
  rangeStart,
  rangeEnd,
  onRangeStartChange,
  onRangeEndChange,
  rangeError,
  pageCount,
  currentPage,
  selectedCandidate,
  scopeSummary,
  analysisResult,
  error,
  disabled,
  activeCandidateId,
  onSelectCandidate,
  flowState,
  flowMessage,
  currentPageSupportedCandidateCount,
  selectedCandidatePlanEligibility,
  onApplyRemoval,
  onDownloadCleanedPdf,
  onDownloadReport,
  outputReady,
  recommendedCandidate,
  unsupportedGuidance,
}: PdfExportControlsProps) {
  const unsupportedPages = analysisResult?.unsupportedPages ?? [];

  const candidateList = useMemo(() => {
    if (!analysisResult) {
      return [];
    }
    const currentPageCandidates = (analysisResult.candidatesByPage[currentPage] ?? []).filter(
      (candidate) => candidate.objectType !== "unsupported_region",
    );
    const prioritized = [...currentPageCandidates].sort((a, b) => {
      const recommendedA = recommendedCandidate?.id === a.id ? 0 : 1;
      const recommendedB = recommendedCandidate?.id === b.id ? 0 : 1;
      if (recommendedA !== recommendedB) {
        return recommendedA - recommendedB;
      }
      const supportedA = a.removability === "supported" ? 0 : 1;
      const supportedB = b.removability === "supported" ? 0 : 1;
      if (supportedA !== supportedB) {
        return supportedA - supportedB;
      }
      const rankA = listRankingScore(a);
      const rankB = listRankingScore(b);
      if (rankA !== rankB) {
        return rankB - rankA;
      }
      return b.confidence - a.confidence;
    });
    return prioritized.slice(0, 18);
  }, [analysisResult, currentPage, recommendedCandidate?.id]);

  const primaryAction = useMemo(() => {
    if (disabled) {
      return {
        disabled: true,
        reason: "Upload NotebookLM export file first.",
      };
    }
    if (flowState === "uploading" || flowState === "analyzing" || flowState === "applying") {
      return {
        disabled: true,
        reason: "Preview is being prepared. Please wait.",
      };
    }
    if (flowState === "completed") {
      return {
        disabled: true,
        reason: "Download cleaned file is ready.",
      };
    }
    if (flowState === "no_candidates" || flowState === "unsupported_page" || flowState === "error") {
      return {
        disabled: true,
        reason: "Current status cannot run cleanup.",
      };
    }
    if (!selectedCandidate) {
      if (recommendedCandidate) {
        return {
          disabled: true,
          reason: "Select the recommended candidate before confirmation.",
        };
      }
      return {
        disabled: true,
        reason: "Please select a candidate.",
      };
    }
    if (!selectedCandidatePlanEligibility.allowed) {
      return {
        disabled: true,
        reason: selectedCandidatePlanEligibility.reason ?? "所选候选对象不支持移除。",
      };
    }
    if (rangeError) {
      return {
        disabled: true,
        reason: rangeError,
      };
    }
    return {
      disabled: false,
      reason: null,
    };
  }, [
    disabled,
    flowState,
    selectedCandidate,
    selectedCandidatePlanEligibility,
    rangeError,
    recommendedCandidate,
  ]);

  const placeholderCopy = FLOW_PLACEHOLDER_COPY[flowState];
  const toneClass = getToneClass(placeholderCopy.tone);

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Cleanup flow</h3>
        <p className="mt-1 text-xs text-slate-600">{flowMessage}</p>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-3">
        <button
          type="button"
          onClick={onApplyRemoval}
          disabled={primaryAction.disabled}
          className="inline-flex w-full items-center justify-center rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Confirm cleanup selection
        </button>
        {primaryAction.reason ? <p className="mt-2 text-xs text-sky-900">{primaryAction.reason}</p> : null}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-800">状态机</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {FLOW_STEPS.map((step) => (
            <span
              key={step}
              className={`rounded-full border px-2.5 py-1 text-[11px] ${
                step === flowState
                  ? "border-sky-500 bg-sky-50 text-sky-800"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              {FLOW_LABEL[step]}
            </span>
          ))}
        </div>
      </div>

      <div className={`space-y-2 rounded-lg border px-3 py-3 ${toneClass}`}>
        <h4 className="text-xs font-semibold uppercase tracking-wide">Status</h4>
        <p className="text-xs font-semibold">{placeholderCopy.title}</p>
        <p className="text-xs">{placeholderCopy.description}</p>
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-800">
          候选对象列表（第 {currentPage} 页）
        </p>
        {candidateList.length > 0 ? (
          <div className="max-h-52 space-y-2 overflow-auto">
            {candidateList.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => onSelectCandidate(candidate.id)}
                className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                  activeCandidateId === candidate.id
                    ? "border-sky-500 bg-sky-50 text-sky-900"
                    : recommendedCandidate?.id === candidate.id
                      ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                <p className="font-semibold">{candidate.label}</p>
                <p className="mt-1">
                  {candidate.objectType} · repeat {candidate.repeatCount} · {candidate.removability}
                </p>
                {recommendedCandidate?.id === candidate.id ? (
                  <p className="mt-1 text-[11px] font-semibold text-emerald-700">Recommended</p>
                ) : null}
                {candidate.reasonCode ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    reason: {candidate.reasonCode}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            {flowState === "unsupported_page"
              ? "This page looks unsupported for object-level cleanup."
              : flowState === "no_candidates"
                ? "No removable candidates found on this page."
                : analysisResult
                  ? "No candidates detected on this page."
                  : "Candidates will appear after preview is ready."}
          </p>
        )}
      </div>

      {recommendedCandidate ? (
        <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
          <p className="font-semibold">推荐候选对象</p>
          <p>{recommendedCandidate.recommendationLabel ?? "Recommended Candidate"}</p>
          <p>
            ID: {recommendedCandidate.id} · page {recommendedCandidate.pageNumber} ·{" "}
            {Math.round(recommendedCandidate.confidence * 100)}%
          </p>
          <p>{recommendedCandidate.reason}</p>
          <p>Start with the recommended candidate for a more stable preview workflow.</p>
        </div>
      ) : null}

      {(flowState === "unsupported_page" || flowState === "no_candidates") && unsupportedGuidance ? (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
          <p className="font-semibold">{unsupportedGuidance.title}</p>
          <p>{unsupportedGuidance.detail}</p>
          <p>Recommendation: {unsupportedGuidance.recommendation}</p>
        </div>
      ) : null}

      {selectedCandidate ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-700">
          <InspectorRow label="Candidate ID" value={selectedCandidate.id} />
          <InspectorRow label="Page" value={String(selectedCandidate.pageNumber)} />
          <InspectorRow label="Object type" value={selectedCandidate.objectType} />
          <InspectorRow label="Label" value={selectedCandidate.label} />
          <InspectorRow label="Bounding box" value={formatRect(selectedCandidate.boundingBox)} />
          <InspectorRow
            label="Normalized"
            value={formatRect(selectedCandidate.normalizedBoundingBox)}
          />
          <InspectorRow label="Repeat count" value={String(selectedCandidate.repeatCount)} />
          <InspectorRow label="Confidence" value={`${Math.round(selectedCandidate.confidence * 100)}%`} />
          <InspectorRow label="Removability" value={selectedCandidate.removability} />
          <InspectorRow label="Repeat key" value={selectedCandidate.repeatKey} />
        </div>
      ) : (
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          No candidate selected yet. Click highlighted regions in preview.
        </p>
      )}

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-800">移除范围</h4>

        <div className="grid gap-2 text-xs text-slate-700">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "current"}
              disabled={disabled}
              onChange={() => onScopeChange("current")}
            />
            Current page ({currentPage})
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "all"}
              disabled={disabled}
              onChange={() => onScopeChange("all")}
            />
            All repeated instances
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === "range"}
              disabled={disabled}
              onChange={() => onScopeChange("range")}
            />
            Page range
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <input
            value={rangeStart}
            onChange={(event) => onRangeStartChange(event.target.value)}
            disabled={scope !== "range" || disabled}
            placeholder="Start page"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50"
          />
          <input
            value={rangeEnd}
            onChange={(event) => onRangeEndChange(event.target.value)}
            disabled={scope !== "range" || disabled}
            placeholder="End page"
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50"
          />
        </div>

        {rangeError ? <p className="text-xs text-rose-700">{rangeError}</p> : null}
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-800">Current scope:</span> {scopeSummary}
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-900">
          Compatibility note
        </h4>
        <p className="text-xs text-amber-900">
          Unsupported structures are blocked to avoid destructive edits.
        </p>
        <p className="text-xs text-amber-900">
          Most stable cases: repeated header/footer text and repeated corner marks.
        </p>
        <p className="text-xs text-amber-800">
          Unsupported signal pages:{" "}
          {unsupportedPages.length > 0 ? unsupportedPages.join(", ") : "none detected"}
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-800">
          Download cleaned file
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onDownloadCleanedPdf}
            disabled={!outputReady}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download cleaned file
          </button>
          <button
            type="button"
            onClick={onDownloadReport}
            disabled={!outputReady}
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download report JSON
          </button>
        </div>
        <p className="text-xs text-slate-600">
          {outputReady
            ? "Download cleaned file is ready."
            : "Output becomes available after preview confirmation."}
        </p>
      </div>

      {error ? <p className="text-xs text-rose-700">{error}</p> : null}

      <p className="text-[11px] text-slate-500">
        Detected candidates: {analysisResult?.totalCandidates ?? 0} · Supported on page:{" "}
        {currentPageSupportedCandidateCount} · Total pages: {pageCount}
      </p>
    </section>
  );
}

function listRankingScore(candidate: PdfObjectCandidate): number {
  let score = candidate.confidence * 100 + candidate.repeatCount * 10;
  const cornerImage =
    candidate.objectType === "image_xobject" && candidate.placementHint === "corner";
  const headerOrFooterText =
    candidate.objectType === "text_run" &&
    (candidate.placementHint === "header" || candidate.placementHint === "footer");

  if (cornerImage) {
    score += 80;
  } else if (candidate.objectType === "image_xobject") {
    score += 35;
  }
  if (headerOrFooterText) {
    score += 26;
  }
  if (candidate.objectType === "text_run") {
    score -= estimateTextNoise(candidate.label);
    if (!headerOrFooterText) {
      score -= 16;
    }
  }
  return score;
}

function estimateTextNoise(text: string): number {
  const value = text.trim();
  if (!value) {
    return 100;
  }
  const printable = value.split("").filter((ch) => /[ -~]/.test(ch)).length;
  const printableRatio = printable / value.length;
  const punct = value.split("").filter((ch) => /[^\p{L}\p{N}\s]/u.test(ch)).length;
  const punctRatio = punct / value.length;
  let score = 0;
  if (value.length <= 3) {
    score += 20;
  }
  score += (1 - printableRatio) * 45;
  score += punctRatio * 25;
  if (/[ÿÝþð]{2,}|[^\p{L}\p{N}\s]{3,}/u.test(value)) {
    score += 25;
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

function getToneClass(tone: "slate" | "sky" | "amber" | "rose" | "emerald") {
  if (tone === "sky") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }
  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  return "border-slate-200 bg-slate-50 text-slate-900";
}

function InspectorRow({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="font-semibold text-slate-800">{label}:</span> {value}
    </p>
  );
}

function formatRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return `x:${rect.x.toFixed(3)} y:${rect.y.toFixed(3)} w:${rect.width.toFixed(3)} h:${rect.height.toFixed(3)}`;
}

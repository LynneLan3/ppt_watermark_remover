import { resolveTargetPages } from "@/lib/local/pdf/range";
import type {
  CleanupScope,
  ObjectRemovalPlan,
  PdfCandidateAnalysisResult,
  PdfObjectCandidate,
} from "@/lib/local/pdf/types";

export function buildObjectRemovalPlan(params: {
  fileName: string;
  candidate: PdfObjectCandidate;
  analysisResult: PdfCandidateAnalysisResult;
  scope: CleanupScope;
  currentPage: number;
  pageCount: number;
  rangeStart?: number;
  rangeEnd?: number;
}): ObjectRemovalPlan {
  const targetPages = resolvePlanTargetPages(params);

  return {
    planVersion: "1.0",
    createdAt: new Date().toISOString(),
    sourceFileName: params.fileName,
    selectedCandidate: params.candidate,
    scope: {
      mode: params.scope,
      targetPages,
      strategy: scopeStrategy(params.scope),
    },
    preferredEngines: ["pikepdf", "PyMuPDF"],
    preservationGoal:
      "Prioritize removing independently identifiable logos, headers, footers, and brand marks while preserving original page appearance as much as possible.",
    engineHints: [
      "Use repeatKey to match sibling objects across pages before deletion.",
      "Skip destructive cover-up if candidate removability is unsupported.",
      "Verify visual diffs per target page after object deletion.",
      "Current local engine MVP supports text_run removal and narrow image_xobject removal.",
      "Current image_xobject MVP is limited to small repeated independent image overlays.",
    ],
    riskLevel: toRiskLevel(params.candidate.removability),
    notes: buildPlanNotes(params),
  };
}

function resolvePlanTargetPages(params: {
  candidate: PdfObjectCandidate;
  analysisResult: PdfCandidateAnalysisResult;
  scope: CleanupScope;
  currentPage: number;
  pageCount: number;
  rangeStart?: number;
  rangeEnd?: number;
}): number[] {
  if (params.scope === "all") {
    const pages = new Set<number>();
    for (const [page, candidates] of Object.entries(params.analysisResult.candidatesByPage)) {
      const match = candidates.some(
        (candidate) => candidate.repeatKey === params.candidate.repeatKey,
      );
      if (match) {
        pages.add(Number(page));
      }
    }

    if (pages.size > 0) {
      return Array.from(pages).sort((a, b) => a - b);
    }

    return [params.candidate.pageNumber];
  }

  return resolveTargetPages(
    params.scope,
    params.currentPage,
    params.pageCount,
    params.rangeStart,
    params.rangeEnd,
  );
}

function scopeStrategy(
  scope: CleanupScope,
): ObjectRemovalPlan["scope"]["strategy"] {
  if (scope === "current") {
    return "current_page";
  }
  if (scope === "all") {
    return "all_matching_repeat_key";
  }
  return "selected_page_range";
}

function toRiskLevel(
  removability: PdfObjectCandidate["removability"],
): ObjectRemovalPlan["riskLevel"] {
  if (removability === "supported") {
    return "low";
  }
  if (removability === "review_required") {
    return "medium";
  }
  return "high";
}

function buildPlanNotes(params: {
  candidate: PdfObjectCandidate;
  analysisResult: PdfCandidateAnalysisResult;
}): string[] {
  const notes = [
    "This JSON is a handoff artifact for a dedicated object-level PDF engine.",
    "PDF.js in browser is used for preview and candidate interaction only.",
  ];

  if (params.candidate.removability !== "supported") {
    notes.push(
      "Candidate removability is not high. Treat this as a review-required or unsupported target before applying deletion.",
    );
  }

  if (params.analysisResult.unsupportedPages.length > 0) {
    notes.push(
      `Flattened/unsupported page signals found on pages: ${params.analysisResult.unsupportedPages.join(", ")}.`,
    );
  }

  return notes;
}

export function getObjectPlanFileName(sourceFileName: string): string {
  const clean = sourceFileName.replace(/\.pdf$/i, "").trim();
  const base = clean.length > 0 ? clean : "document";
  return `${base}.removal-plan.json`;
}

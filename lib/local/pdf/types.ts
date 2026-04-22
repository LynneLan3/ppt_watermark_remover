export type CleanupScope = "current" | "all" | "range";

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type NormalizedRect = Rect;

export type PdfObjectType =
  | "text_run"
  | "image_xobject"
  | "form_xobject"
  | "repeated_overlay"
  | "unsupported_region";

export type Removability = "supported" | "review_required" | "unsupported";

export type PdfObjectCandidate = {
  id: string;
  pageNumber: number;
  objectType: PdfObjectType;
  text?: string;
  boundingBox: Rect;
  normalizedBoundingBox: NormalizedRect;
  repeatCount: number;
  confidence: number;
  label: string;
  key: string;
  repeatKey: string;
  identityKey?: string;
  imageIdentityKey?: string;
  resourceName?: string;
  removability: Removability;
  reasons: string[];
  reasonCode?: string;
  unsupportedReasonCode?: string;
  placementHint?: "corner" | "header" | "footer" | "side" | "body" | "background" | "unknown";
};

export type PdfCandidateAnalysisResult = {
  candidatesByPage: Record<number, PdfObjectCandidate[]>;
  totalCandidates: number;
  unsupportedPages: number[];
  notes: string[];
};

export type ObjectRemovalPlan = {
  planVersion: "1.0";
  createdAt: string;
  sourceFileName: string;
  selectedCandidate: PdfObjectCandidate;
  scope: {
    mode: CleanupScope;
    targetPages: number[];
    strategy:
      | "current_page"
      | "all_matching_repeat_key"
      | "selected_page_range";
  };
  preferredEngines: Array<"pikepdf" | "PyMuPDF">;
  preservationGoal: string;
  engineHints: string[];
  riskLevel: "low" | "medium" | "high";
  notes: string[];
};

export type LegacyPdfCoverWorkerRequest = {
  pdfBytes: ArrayBuffer;
  selection: NormalizedRect;
  scope: CleanupScope;
  currentPage: number;
  pageCount: number;
  rangeStart?: number;
  rangeEnd?: number;
};

export type LegacyPdfCoverWorkerSuccess = {
  ok: true;
  pdfBytes: ArrayBuffer;
};

export type LegacyPdfCoverWorkerError = {
  ok: false;
  error: string;
};

export type LegacyPdfCoverWorkerResponse =
  | LegacyPdfCoverWorkerSuccess
  | LegacyPdfCoverWorkerError;

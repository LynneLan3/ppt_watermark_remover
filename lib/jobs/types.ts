export type JobStatus =
  | "created"
  | "uploaded"
  | "analyzing"
  | "ready_for_review"
  | "processing"
  | "partial_failed"
  | "ready_for_download"
  | "downloaded"
  | "expired"
  | "failed";

export type CandidateKind = "text" | "image" | "vector";

export type CandidateBBoxSample = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CandidateBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CandidateAnchor = {
  page: number;
  commandStart: number;
  commandEnd: number;
  operatorType: "xobject_do" | "vector_paint" | "text_show" | "text_block";
  operatorName: string;
  resourceName: string;
  resourceKind?: "xobject" | "font" | "graphics_state" | "content_stream";
  bbox: CandidateBBox;
  ctm?: [number, number, number, number, number, number];
  graphicsDepth: number;
  textBlockId?: string;
  reliability: "reliable" | "probable" | "weak";
  streamRef?: string;
  commandWindowBefore?: string[];
  commandWindowAfter?: string[];
  blockId?: string;
  pathStart?: number;
  pathEnd?: number;
  paintStart?: number;
  paintEnd?: number;
  spanShapeSignature?: string;
  paintOperators?: string[];
  pathOperators?: string[];
  stateOperators?: string[];
  removalStrategy?:
    | "remove_xobject_do_ops"
    | "remove_vector_ops_by_range"
    | "remove_text_ops_by_range"
    | "no_reliable_anchor";
};

export type CleanupCandidate = {
  id: string;
  kind: CandidateKind;
  label: string;
  pages: number[];
  confidence: number;
  bboxSamples: CandidateBBoxSample[];
  repeatedCount: number;
  reasons: string[];
  safeToRemove: boolean;
  anchors: CandidateAnchor[];
  unsupportedTags: Array<
    | "rasterized_full_page_watermark"
    | "background_integrated_mark"
    | "destructive_removal_risk"
  >;
};

export type SelectionApplyMode = "current_page" | "all_repeated" | "page_range";

export type JobSelectionItem = {
  candidateId: string;
  applyMode: SelectionApplyMode;
  explicitPages: number[];
};

export type JobSelection = {
  items: JobSelectionItem[];
  updatedAt: string;
};

export type JobReviewPayload = {
  generatedAt: string;
  supportedCount: number;
  unsupportedCount: number;
  candidates: CleanupCandidate[];
  unsupportedReasons: Record<string, number>;
  notes: string[];
  documentMode?: "object_level" | "raster_page";
  recommendedProcessMode?: "object_level_v2" | "raster_repair_v1";
  watermarkRegionHint?: "right_bottom" | "unknown";
  pageImageLikeRatio?: number;
  repeatedWatermarkPages?: number[];
  logoPositionStats?: {
    rightBottom: number;
    rightBottomRatio: number;
    unknown: number;
  };
  rasterPageAnalysis?: {
    pageCount: number;
    imageLikePageCount: number;
    imageLikeRatio: number;
    repeatedBottomRightMarkPages: number;
    repeatedBottomRightMarkRatio: number;
    watermarkRegionHint: "right_bottom" | "unknown";
    recommendedProcessMode: "raster_repair_v1";
    fullPageRasterSignalCount: number;
    pageImageLikeRatio: number;
    repeatedWatermarkPages: number[];
    logoPositionStats: {
      rightBottom: number;
      rightBottomRatio: number;
      unknown: number;
    };
  };
  qualityMetrics: QualityMetrics;
  metricsComparison?: QualityMetricsComparison;
  executionPayload: {
    pageCommandCount: number;
  };
};

export type JobAnalysisSnapshot = {
  analyzedAt: string;
  totalRawCandidates: number;
  totalPageCommands: number;
  totalV1Candidates: number;
  reviewPayloadPath: string;
  candidatesPath: string;
  rawAnalysisPath: string;
  pageCommandsPath: string;
};

export type JobRecord = {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  retentionSeconds: number;
  sourceFilename?: string;
  sourcePdfPath?: string;
  sourceBlobUrl?: string;
  sourcePathname?: string;
  sourceSize?: number;
  sourceContentType?: string;
  uploadToken?: string;
  uploadTokenExpiresAt?: string;
  analysis?: JobAnalysisSnapshot;
  selection?: JobSelection;
  processOutputPath?: string;
  processReportPath?: string;
  processOutputBlobUrl?: string;
  processReportBlobUrl?: string;
  downloadedAt?: string;
  failureCode?: JobErrorCode;
  failureMessage?: string;
};

export type ProcessOperationReport = {
  candidateId: string;
  anchorId?: string;
  operation: string;
  page: number;
  success: boolean;
  detail?: string | Record<string, unknown>;
};

export type ProcessSkipReport = {
  candidateId: string;
  anchorId?: string;
  page: number;
  reason: string;
  detail?: Record<string, unknown>;
};

export type ProcessReportV2 = {
  processedAt: string;
  algorithmProfile?: string;
  processMode?: "object_level_v2" | "raster_repair_v1";
  selectedCandidates: JobSelectionItem[];
  appliedOperations: ProcessOperationReport[];
  skippedOperations: ProcessSkipReport[];
  skippedReasons: Record<string, number>;
  inputPageCount: number;
  outputPageCount: number;
  processedPageCount?: number;
  repairedPageCount?: number;
  skippedPageCount?: number;
  failedPageCount?: number;
  secondPassTriggeredPageCount?: number;
  failedReasonCounts?: Record<string, number>;
  overallVisualSuccess?: boolean;
  status?: "success" | "failed_visual_verification" | "fatal_error";
  watermarkDetectionMode?: string;
  dominantTemplateId?: "template_compact" | "template_wide";
  perPageResults?: Array<{
    page: number;
    pageWidth?: number;
    pageHeight?: number;
    renderWidth?: number;
    renderHeight?: number;
    cropBox?: { x0: number; y0: number; x1: number; y1: number; width: number; height: number };
    mediaBox?: { x0: number; y0: number; x1: number; y1: number; width: number; height: number };
    rotation?: number;
    roi?: { x: number; y: number; width: number; height: number };
    detectedWatermarkBox?: { x: number; y: number; width: number; height: number };
    detectedBoxNormalized?: { x: number; y: number; width: number; height: number };
    mappedProcessBox?: { x: number; y: number; width: number; height: number };
    rawDetectionBox?: { x: number; y: number; width: number; height: number };
    clampedDetectionBox?: { x: number; y: number; width: number; height: number };
    finalMaskBox?: { x: number; y: number; width: number; height: number };
    expandedMaskBox?: { x: number; y: number; width: number; height: number };
    pageTheme?: "dark_image_page" | "light_document_page";
    pageStyleClass?:
      | "dark_plain"
      | "dark_glow_panel"
      | "light_plain"
      | "light_gridline"
      | "light_gradient"
      | "light_complex_diagram"
      | "mixed_structure";
    repairPolicy?: string;
    templateId?: "template_compact" | "template_wide";
    dominantTemplateId?: "template_compact" | "template_wide";
    marginRight?: number;
    marginBottom?: number;
    repairAreaRatio?: number;
    maskAreaRatioWithinTemplate?: number;
    maskHeightRatioWithinTemplate?: number;
    templateScore?: number;
    rerunCount?: number;
    degradedMode?: boolean;
    fallbackChain?: string[];
    glyphBoundingBox?: { x: number; y: number; width: number; height: number } | null;
    logoComponentBox?: { x: number; y: number; width: number; height: number } | null;
    fringeBox?: { x: number; y: number; width: number; height: number } | null;
    conservativeTemplateBox?: { x: number; y: number; width: number; height: number } | null;
    maskGenerationMode?: "glyph_bbox" | "fallback_rect" | "union_mask" | "template_union";
    selectedRepairMethod?: string | null;
    blendMode?: string | null;
    cornerTemplateResidual?: number | null;
    humanReviewRecommended?: boolean;
    visualVerificationPassed?: boolean;
    removalPassPassed?: boolean;
    damageControlPassPassed?: boolean;
    structureBreakScore?: number;
    residualWatermarkScore?: number;
    brightGlyphResidualScore?: number;
    edgeTemplateResidualScore?: number;
    templateSimilarityBefore?: number;
    templateSimilarityAfter?: number;
    textResidualScore?: number;
    damageLumaDelta?: number;
    brightnessDelta?: number;
    damageTextureDelta?: number;
    damageSeamScore?: number;
    shrinkStrategy?: "mask_bbox" | "center_shrink" | "fallback";
    secondPassTriggered?: boolean;
    secondPassBox?: { x: number; y: number; width: number; height: number } | null;
    secondPassStrategy?: string | null;
    failureReasonDetailed?: string | null;
    failureCategory?:
      | "watermark removal insufficient"
      | "damage too high"
      | "structure break"
      | "brightness mismatch"
      | "gradient mismatch"
      | null;
    lightComplexCandidates?: Array<{
      candidateId: string;
      method?: string | null;
      score: number;
      structureBreakScore: number;
      residualWatermarkScore: number;
      damageTextureDelta: number;
      damageSeamScore: number;
      brightnessDelta: number;
      residualHotspotBox?: { x: number; y: number; width: number; height: number } | null;
      trailingCleanupMaskBox?: { x: number; y: number; width: number; height: number } | null;
      trailingCleanupApplied?: boolean;
      trailingFeatherRadius?: number;
      trailingBrightnessMatched?: boolean;
      trailingBrightnessBefore?: number;
      trailingBrightnessAfter?: number;
      trailingSeamBefore?: number;
      trailingSeamAfter?: number;
      structureProtectionTriggered?: boolean;
    }>;
    residualHotspotBox?: { x: number; y: number; width: number; height: number } | null;
    trailingCleanupMaskBox?: { x: number; y: number; width: number; height: number } | null;
    trailingCleanupApplied?: boolean;
    trailingFeatherRadius?: number;
    trailingBrightnessMatched?: boolean;
    trailingBrightnessBefore?: number;
    trailingBrightnessAfter?: number;
    trailingSeamBefore?: number;
    trailingSeamAfter?: number;
    seamGuardTriggered?: boolean;
    brightnessGuardTriggered?: boolean;
    structureProtectionTriggered?: boolean;
    selectedCandidateReason?: string;
    seamRingApplied?: boolean;
    seamRingWidth?: number;
    seamRingAccepted?: boolean;
    seamRingRejectedReason?: string;
    seamRingStructureDense?: boolean;
    seamRingResidualBefore?: number;
    seamRingResidualAfter?: number;
    seamRingTextureBefore?: number;
    seamRingTextureAfter?: number;
    seamRingSeamBefore?: number;
    seamRingSeamAfter?: number;
    seamRingBrightnessBefore?: number;
    seamRingBrightnessAfter?: number;
    passBeforeSeamRing?: boolean;
    passAfterSeamRing?: boolean;
    passPreservingRollbackTriggered?: boolean;
    v4CandidateFrozen?: boolean;
    seamMicroPolishAttempted?: boolean;
    seamMicroPolishApplied?: boolean;
    seamMicroPolishAccepted?: boolean;
    seamMicroPolishRejectedReason?: string;
    seamMicroPolishRingWidth?: number;
    seamMicroPolishAlphaDelta?: number;
    seamMicroPolishReferenceMode?: string;
    seamMicroPolishResidualBefore?: number;
    seamMicroPolishResidualAfter?: number;
    seamMicroPolishTextureBefore?: number;
    seamMicroPolishTextureAfter?: number;
    seamMicroPolishSeamBefore?: number;
    seamMicroPolishSeamAfter?: number;
    seamMicroPolishBrightnessBefore?: number;
    seamMicroPolishBrightnessAfter?: number;
    passBeforeV6?: boolean;
    passAfterV6?: boolean;
    v5PassedBecameFailedCount?: number;
    v5PassBecameFailed?: boolean;
    v6RollbackTriggered?: boolean;
    textureSurgeAbortTriggered?: boolean;
    abortedCandidateName?: string;
    textureDeltaIncrease?: number;
    fallbackCandidateName?: string;
    wasClamped?: boolean;
    wasShrunk?: boolean;
    skipReason?: string | null;
    analyzeOverlayPath?: string;
    processOverlayPath?: string;
    debugArtifacts?: {
      originalCropPath?: string;
      maskOverlayPath?: string;
      expandedMaskOverlayPath?: string;
      repairedCropPath?: string;
      repairedCropPass1Path?: string;
      repairedCropPass2Path?: string;
      pass1Pass2ComparePath?: string;
      diffOrResidualPath?: string;
      residualPath?: string;
      damageHeatmapPath?: string;
      structureLineOverlayPath?: string;
      seamRingOverlayPath?: string;
      seamMicroPolishOverlayPath?: string;
    };
    repairMethod?:
      | "solid_fill"
      | "gradient_fill"
      | "clone_patch"
      | "opencv_inpaint"
      | "background_reconstruction"
      | "dark_glow_panel_reconstruction"
      | "light_plain_repair_v1"
      | "light_gridline_repair_v1"
      | "light_gradient_repair_v1"
      | "light_complex_diagram_repair_v1";
    success: boolean;
    reason?: string;
    note?: string;
  }>;
  repairMethodStats?: Record<string, number>;
  failedCategoryCounts?: Record<string, number>;
  warnings: string[];
  qualityMetrics: QualityMetrics;
  metricsComparison?: QualityMetricsComparison;
  debugArtifactPath?: string;
  debugSummaryPath?: string;
  bucketDiagnosticsMetrics?: BucketDiagnosticsMetrics;
  fatalError?: string;
};

export type ImageSkipReason =
  | "full_page_candidate_blocked"
  | "unsafe_candidate_blocked"
  | "operator_mismatch"
  | "resource_name_mismatch"
  | "no_instruction_removed"
  | "delete_pass_removed_zero_commands";

export type ImageSkipSubtype =
  | "full_page_slide_raster"
  | "likely_page_background_image"
  | "unsafe_candidate_blocked"
  | "operator_mismatch"
  | "resource_name_mismatch"
  | "delete_pass_removed_zero_commands"
  | "unknown";

export type ImageSkippedTopCandidate = {
  candidateId: string;
  skipCount: number;
  topReason: ImageSkipReason;
  topSubtype: ImageSkipSubtype;
};

export type ImageSkippedSummary = {
  totalImageSkipped: number;
  byReason: Record<ImageSkipReason, number>;
  bySubtype: Record<string, number>;
  topAffectedCandidates: ImageSkippedTopCandidate[];
};

export type BucketDiagnosticsMetrics = {
  topExporterBucketBySkipCount: string;
  topExporterBucketBySpanShapeMismatch: string;
  topTemplateBucketByMissingPathSegment: string;
  topTemplateBucketByVectorNoInstructionRemoved: string;
  topStructureBucketByDeleteRemovedZeroCommands: string;
  exporterBucketCount: number;
  templateBucketCount: number;
  structureBucketCount: number;
  topExporterFailureBuckets: string[];
  topTemplateFailureBuckets: string[];
  topStructureFailureBuckets: string[];
};

export type QualityMetrics = {
  candidateCount: number;
  anchorCount: number;
  reliableAnchorCount: number;
  reliableAnchorRate: number;
  attemptedOperationCount: number;
  appliedOperationCount: number;
  noInstructionRemovedCount: number;
  partialHitCandidateCount: number;
  removalSuccessRate: number;
  vectorAttemptedOperationCount: number;
  vectorAppliedOperationCount: number;
  vectorNoInstructionRemovedCount: number;
  vectorRemovalSuccessRate: number;
  vectorSpanShapeMismatchCount: number;
  vectorGraphicsDepthMismatchCount: number;
  vectorMissingPathSegmentCount: number;
  vectorMissingPaintSegmentCount: number;
  vectorRequiredPaintOperatorMissingCount: number;
  vectorSignaturePrefixMismatchCount: number;
  vectorSignatureOperatorSequenceMismatchCount: number;
  vectorSignatureBBoxMismatchCount: number;
  vectorDeleteRemovedZeroCommandsCount: number;
  vectorResidualPathLeftCount: number;
  vectorResidualPaintLeftCount: number;
};

export type QualityMetricsComparison = {
  previous: QualityMetrics;
  current: QualityMetrics;
  delta: QualityMetrics;
};

export type JobErrorCode =
  | "ok"
  | "validation_error"
  | "not_found"
  | "job_not_found"
  | "upload_not_finalized"
  | "blob_path_conflict"
  | "invalid_state"
  | "upload_token_invalid"
  | "upload_token_expired"
  | "unsupported_format"
  | "analysis_failed"
  | "process_failed"
  | "python_process_failed"
  | "page_count_mismatch"
  | "processed_file_missing"
  | "process_report_incomplete"
  | "download_unavailable"
  | "internal_error";

export type JobApiResponse<T> = {
  success: boolean;
  code: JobErrorCode | "ok";
  message: string;
  job?: JobRecord;
  data?: T;
};

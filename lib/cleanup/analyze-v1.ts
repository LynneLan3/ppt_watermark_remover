import "server-only";

import { classifyAnchorReliability, shouldExecuteAnchor } from "@/lib/cleanup/anchor-reliability";
import {
  groupCommandsByPage,
  parsePageCommandsPayload,
  type PageCommand,
} from "@/lib/cleanup/content-command-model";
import { analyzeRasterPageMode } from "@/lib/cleanup/raster-page-analysis";
import { buildTextFingerprint } from "@/lib/cleanup/text-fingerprint";
import { extractVectorDrawingBlocks, type VectorDrawingBlock } from "@/lib/cleanup/vector-span";
import type {
  CandidateAnchor,
  CleanupCandidate,
  JobReviewPayload,
  QualityMetrics,
  QualityMetricsComparison,
} from "@/lib/jobs/types";

type BuildAnalyzeReviewInput = {
  rawAnalysis: unknown;
  pageCommandsRaw: unknown;
  previousMetrics?: QualityMetrics | null;
};

type RawAnalysisResult = {
  notes?: string[];
  candidatesByPage?: Record<string, unknown[]>;
};

type CandidateGroup = {
  kind: CleanupCandidate["kind"];
  label: string;
  commands: PageCommand[];
  vectorBlocks?: VectorDrawingBlock[];
};

const WINDOW_SIZE = 2;

export function buildAnalyzeV1Review(input: BuildAnalyzeReviewInput): {
  candidates: CleanupCandidate[];
  reviewPayload: JobReviewPayload;
} {
  const parsedRaw = (input.rawAnalysis ?? {}) as RawAnalysisResult;
  const notes = parsedRaw.notes ?? [];
  const pageCommandsPayload = parsePageCommandsPayload(input.pageCommandsRaw);
  const pageCommandMap = groupCommandsByPage(pageCommandsPayload.pageCommands);
  const groups = buildCandidateGroups(pageCommandsPayload.pageCommands);
  const candidates = groups.map((group, index) => buildCandidateFromGroup(group, index, pageCommandMap));
  const unsupportedReasons = collectUnsupportedReasons(candidates);
  const qualityMetrics = buildQualityMetrics(candidates);
  const metricsComparison = input.previousMetrics
    ? buildMetricsComparison(input.previousMetrics, qualityMetrics)
    : undefined;
  const rasterModeAnalysis = analyzeRasterPageMode({
    pageCommands: pageCommandsPayload.pageCommands,
    candidates,
  });

  const reviewPayload: JobReviewPayload = {
    generatedAt: new Date().toISOString(),
    supportedCount: candidates.filter((candidate) => candidate.safeToRemove).length,
    unsupportedCount: candidates.filter((candidate) => !candidate.safeToRemove).length,
    candidates,
    unsupportedReasons,
    notes,
    documentMode: rasterModeAnalysis.documentMode,
    recommendedProcessMode: rasterModeAnalysis.recommendedProcessMode,
    watermarkRegionHint: rasterModeAnalysis.watermarkRegionHint,
    pageImageLikeRatio: rasterModeAnalysis.pageImageLikeRatio,
    repeatedWatermarkPages: rasterModeAnalysis.repeatedWatermarkPages,
    logoPositionStats: rasterModeAnalysis.logoPositionStats,
    rasterPageAnalysis: rasterModeAnalysis.rasterPageAnalysis,
    qualityMetrics,
    metricsComparison,
    executionPayload: {
      pageCommandCount: pageCommandsPayload.pageCommands.length,
    },
  };
  return { candidates, reviewPayload };
}

export function buildMetricsComparison(
  previous: QualityMetrics,
  current: QualityMetrics,
): QualityMetricsComparison {
  return {
    previous,
    current,
    delta: {
      candidateCount: current.candidateCount - previous.candidateCount,
      anchorCount: current.anchorCount - previous.anchorCount,
      reliableAnchorCount: current.reliableAnchorCount - previous.reliableAnchorCount,
      reliableAnchorRate: round4(current.reliableAnchorRate - previous.reliableAnchorRate),
      attemptedOperationCount: current.attemptedOperationCount - previous.attemptedOperationCount,
      appliedOperationCount: current.appliedOperationCount - previous.appliedOperationCount,
      noInstructionRemovedCount:
        current.noInstructionRemovedCount - previous.noInstructionRemovedCount,
      partialHitCandidateCount:
        current.partialHitCandidateCount - previous.partialHitCandidateCount,
      removalSuccessRate: round4(current.removalSuccessRate - previous.removalSuccessRate),
      vectorAttemptedOperationCount:
        current.vectorAttemptedOperationCount - previous.vectorAttemptedOperationCount,
      vectorAppliedOperationCount:
        current.vectorAppliedOperationCount - previous.vectorAppliedOperationCount,
      vectorNoInstructionRemovedCount:
        current.vectorNoInstructionRemovedCount - previous.vectorNoInstructionRemovedCount,
      vectorRemovalSuccessRate:
        round4(current.vectorRemovalSuccessRate - previous.vectorRemovalSuccessRate),
      vectorSpanShapeMismatchCount:
        current.vectorSpanShapeMismatchCount - previous.vectorSpanShapeMismatchCount,
      vectorGraphicsDepthMismatchCount:
        current.vectorGraphicsDepthMismatchCount - previous.vectorGraphicsDepthMismatchCount,
      vectorMissingPathSegmentCount:
        current.vectorMissingPathSegmentCount - previous.vectorMissingPathSegmentCount,
      vectorMissingPaintSegmentCount:
        current.vectorMissingPaintSegmentCount - previous.vectorMissingPaintSegmentCount,
      vectorRequiredPaintOperatorMissingCount:
        current.vectorRequiredPaintOperatorMissingCount -
        previous.vectorRequiredPaintOperatorMissingCount,
      vectorSignaturePrefixMismatchCount:
        current.vectorSignaturePrefixMismatchCount - previous.vectorSignaturePrefixMismatchCount,
      vectorSignatureOperatorSequenceMismatchCount:
        current.vectorSignatureOperatorSequenceMismatchCount -
        previous.vectorSignatureOperatorSequenceMismatchCount,
      vectorSignatureBBoxMismatchCount:
        current.vectorSignatureBBoxMismatchCount - previous.vectorSignatureBBoxMismatchCount,
      vectorDeleteRemovedZeroCommandsCount:
        current.vectorDeleteRemovedZeroCommandsCount - previous.vectorDeleteRemovedZeroCommandsCount,
      vectorResidualPathLeftCount:
        current.vectorResidualPathLeftCount - previous.vectorResidualPathLeftCount,
      vectorResidualPaintLeftCount:
        current.vectorResidualPaintLeftCount - previous.vectorResidualPaintLeftCount,
    },
  };
}

function buildCandidateGroups(commands: PageCommand[]): CandidateGroup[] {
  const imageGroups = new Map<string, PageCommand[]>();
  const vectorGroups = new Map<string, VectorDrawingBlock[]>();
  const textGroups = new Map<string, PageCommand[]>();

  for (const command of commands) {
    if (command.operatorType === "xobject_do") {
      const key = [
        "image",
        normalizeResource(command.resourceName),
        quantizedBbox(command),
        quantizedCtm(command.ctm),
      ].join("|");
      pushGroup(imageGroups, key, command);
      continue;
    }
    if (command.operatorType === "vector_paint") {
      continue;
    }
    if (command.operatorType === "text_show") {
      const fp = buildTextFingerprint({
        command,
        candidate: { pages: [command.page] },
        blockLocalOrder: command.commandIndex,
      });
      const key = [
        "text",
        fp.normalizedText,
        fp.fontName,
        `size:${fp.fontSize}`,
        fp.quantizedPosition,
        `order:${fp.blockLocalOrder}`,
      ].join("|");
      pushGroup(textGroups, key, command);
    }
  }
  const vectorBlocks = extractVectorDrawingBlocks(commands);
  for (const block of vectorBlocks) {
    const key = [
      "vector",
      block.patternSignature,
      `bbox:${Math.round(block.bbox.x * 200)}:${Math.round(block.bbox.y * 200)}`,
    ].join("|");
    pushVectorGroup(vectorGroups, key, block);
  }

  const groups: CandidateGroup[] = [];
  let serial = 0;
  for (const [, items] of imageGroups.entries()) {
    groups.push({
      kind: "image",
      label: `Repeated image mark #${serial++}`,
      commands: sortCommands(items),
    });
  }
  for (const [, items] of vectorGroups.entries()) {
    groups.push({
      kind: "vector",
      label: `Repeated vector mark #${serial++}`,
      commands: [],
      vectorBlocks: sortVectorBlocks(items),
    });
  }
  for (const [, items] of textGroups.entries()) {
    groups.push({
      kind: "text",
      label: `Repeated text mark #${serial++}`,
      commands: sortCommands(items),
    });
  }
  return groups.filter(
    (group) => group.commands.length > 0 || (group.vectorBlocks?.length ?? 0) > 0,
  );
}

function buildCandidateFromGroup(
  group: CandidateGroup,
  serial: number,
  pageCommandMap: Map<number, PageCommand[]>,
): CleanupCandidate {
  const pages =
    group.kind === "vector"
      ? uniqueSorted((group.vectorBlocks ?? []).map((block) => block.page))
      : uniqueSorted(group.commands.map((command) => command.page));
  const repeatedCount = pages.length;
  const confidence = scoreGroupConfidence(group, repeatedCount);
  const preliminarySafe = repeatedCount >= 2;

  const anchors =
    group.kind === "vector"
      ? (group.vectorBlocks ?? []).map((block) =>
          buildVectorAnchorFromBlock(block, preliminarySafe, repeatedCount, confidence),
        )
      : group.commands.map((command) =>
          buildAnchorFromCommand(
            group.kind,
            command,
            preliminarySafe,
            repeatedCount,
            confidence,
            pageCommandMap,
          ),
        );
  const hasExecutableAnchor = anchors.some((anchor) =>
    shouldExecuteAnchor({ reliability: anchor.reliability, operatorType: anchor.operatorType }),
  );
  const imageRisk = group.kind === "image" ? assessImageGroupRisk(group, pages) : null;
  const safeToRemove =
    preliminarySafe &&
    !(imageRisk?.fullPageLike ?? false) &&
    (group.kind === "text"
      ? anchors.some((anchor) => anchor.reliability === "reliable")
      : hasExecutableAnchor);

  const unsupportedTags = safeToRemove
    ? []
    : buildUnsupportedTagsForGroup(group.kind, repeatedCount, hasExecutableAnchor, imageRisk);

  const reasons = buildCandidateReasons(
    group,
    safeToRemove,
    repeatedCount,
    hasExecutableAnchor,
    imageRisk,
  );
  const bboxSamples =
    group.kind === "vector"
      ? (group.vectorBlocks ?? []).slice(0, 6).map((block) => ({
          page: block.page,
          x: block.bbox.x,
          y: block.bbox.y,
          width: block.bbox.width,
          height: block.bbox.height,
        }))
      : group.commands.slice(0, 6).map((command) => ({
          page: command.page,
          x: command.bbox.x,
          y: command.bbox.y,
          width: command.bbox.width,
          height: command.bbox.height,
        }));

  return {
    id: `${group.kind}-${serial}`,
    kind: group.kind,
    label: group.label,
    pages,
    confidence,
    bboxSamples,
    repeatedCount,
    reasons,
    safeToRemove,
    anchors,
    unsupportedTags,
  };
}

function buildAnchorFromCommand(
  kind: CleanupCandidate["kind"],
  command: PageCommand,
  safeToRemove: boolean,
  repeatedCount: number,
  confidence: number,
  pageCommandMap: Map<number, PageCommand[]>,
): CandidateAnchor {
  const commandStart = Math.max(0, command.commandIndex - (kind === "vector" ? 1 : 0));
  const commandEnd = command.commandIndex + (kind === "vector" ? 1 : 0);
  const hasValidRange = commandEnd >= commandStart;

  const reliability = classifyAnchorReliability({
    candidate: {
      kind,
      repeatedCount,
      confidence,
      safeToRemove,
    },
    command,
    hasValidRange,
  });

  const removalStrategy =
    kind === "text"
      ? reliability === "reliable"
        ? "remove_text_ops_by_range"
        : "no_reliable_anchor"
      : kind === "image"
        ? reliability === "weak"
          ? "no_reliable_anchor"
          : "remove_xobject_do_ops"
        : reliability === "weak"
          ? "no_reliable_anchor"
          : "remove_vector_ops_by_range";

  const pageCommands = pageCommandMap.get(command.page) ?? [];
  const before = pageCommands
    .filter((item) => item.commandIndex < command.commandIndex)
    .slice(-WINDOW_SIZE)
    .map((item) => item.operatorName);
  const after = pageCommands
    .filter((item) => item.commandIndex > command.commandIndex)
    .slice(0, WINDOW_SIZE)
    .map((item) => item.operatorName);

  return {
    page: command.page,
    commandStart,
    commandEnd,
    operatorType: command.operatorType,
    operatorName: command.operatorName,
    resourceName: command.resourceName,
    resourceKind:
      kind === "image" ? "xobject" : kind === "text" ? "font" : "content_stream",
    bbox: command.bbox,
    ctm: command.ctm,
    graphicsDepth: command.graphicsDepth,
    textBlockId: command.textBlockId,
    reliability,
    streamRef: `page-${command.page}`,
    removalStrategy,
    commandWindowBefore: before,
    commandWindowAfter: after,
  };
}

function scoreGroupConfidence(group: CandidateGroup, repeatedCount: number): number {
  if (group.kind === "vector") {
    const blocks = group.vectorBlocks ?? [];
    const hasCompleteBlocks = blocks.every((block) => block.pathOperators.length > 0 && block.paintOperators.length > 0);
    const signatureCount = uniqueSortedStrings(blocks.map((block) => block.patternSignature)).length;
    const stablePattern = signatureCount === 1;
    const base = hasCompleteBlocks ? 0.7 : 0.45;
    const repeatBoost = Math.min(0.2, repeatedCount * 0.04);
    const patternBoost = stablePattern ? 0.08 : 0;
    return clamp01(base + repeatBoost + patternBoost);
  }
  const base = group.kind === "text" ? 0.62 : group.kind === "image" ? 0.68 : 0.65;
  const repeatBoost = Math.min(0.25, repeatedCount * 0.05);
  const operatorConsistency =
    uniqueSortedStrings(group.commands.map((command) => command.operatorName)).length === 1
      ? 0.05
      : 0;
  return clamp01(base + repeatBoost + operatorConsistency);
}

function buildVectorAnchorFromBlock(
  block: VectorDrawingBlock,
  safeToRemove: boolean,
  repeatedCount: number,
  confidence: number,
): CandidateAnchor {
  const completeBoundary =
    block.commandStart <= block.pathStart &&
    block.pathStart <= block.pathEnd &&
    block.pathEnd <= block.paintStart &&
    block.paintStart <= block.paintEnd &&
    block.paintEnd <= block.commandEnd;
  const stableShape = block.pathOperators.length > 0 && block.paintOperators.length > 0;
  const bboxStable = block.bbox.width > 0 && block.bbox.height > 0;

  let reliability: CandidateAnchor["reliability"] = "weak";
  if (
    completeBoundary &&
    stableShape &&
    bboxStable &&
    repeatedCount >= 2 &&
    Number.isFinite(block.graphicsDepth)
  ) {
    reliability = confidence >= 0.78 ? "reliable" : "probable";
  } else if (completeBoundary && stableShape && repeatedCount >= 2) {
    reliability = "probable";
  }

  const executable = shouldExecuteAnchor({
    reliability,
    operatorType: "vector_paint",
  });

  return {
    page: block.page,
    commandStart: block.commandStart,
    commandEnd: block.commandEnd,
    operatorType: "vector_paint",
    operatorName: block.paintOperators[0] ?? "S",
    resourceName: "VECTOR_BLOCK",
    resourceKind: "content_stream",
    bbox: block.bbox,
    ctm: [1, 0, 0, 1, Number(block.bbox.x.toFixed(4)), Number(block.bbox.y.toFixed(4))],
    graphicsDepth: block.graphicsDepth,
    reliability,
    streamRef: `page-${block.page}`,
    removalStrategy: safeToRemove && executable ? "remove_vector_ops_by_range" : "no_reliable_anchor",
    blockId: block.blockId,
    pathStart: block.pathStart,
    pathEnd: block.pathEnd,
    paintStart: block.paintStart,
    paintEnd: block.paintEnd,
    spanShapeSignature: block.spanShapeSignature,
    paintOperators: block.paintOperators,
    pathOperators: block.pathOperators,
    stateOperators: block.stateOperators,
  };
}

function buildUnsupportedTagsForGroup(
  kind: CleanupCandidate["kind"],
  repeatedCount: number,
  hasExecutableAnchor: boolean,
  imageRisk?: { fullPageLike: boolean } | null,
): CleanupCandidate["unsupportedTags"] {
  const tags = new Set<CleanupCandidate["unsupportedTags"][number]>();
  if (repeatedCount <= 1) {
    tags.add("background_integrated_mark");
  }
  if (!hasExecutableAnchor) {
    tags.add("destructive_removal_risk");
  }
  if (kind === "image" && (repeatedCount <= 1 || imageRisk?.fullPageLike)) {
    tags.add("rasterized_full_page_watermark");
  }
  if (tags.size <= 0) {
    tags.add("destructive_removal_risk");
  }
  return Array.from(tags);
}

function buildCandidateReasons(
  group: CandidateGroup,
  safeToRemove: boolean,
  repeatedCount: number,
  hasExecutableAnchor: boolean,
  imageRisk?: {
    fullPageLike: boolean;
    largeImageLike: boolean;
    coverageRatio: number;
    repeatedPagesRatio: number;
  } | null,
): string[] {
  const reasons = new Set<string>();
  if (group.kind === "text") {
    reasons.add("repeated_text_show_cluster");
  } else if (group.kind === "image") {
    reasons.add("repeated_xobject_do_cluster");
  } else {
    reasons.add("repeated_vector_paint_cluster");
  }
  reasons.add(`repeated_pages:${repeatedCount}`);
  if (group.kind === "image" && imageRisk) {
    reasons.add(`coverage_ratio:${imageRisk.coverageRatio}`);
    reasons.add(`repeated_pages_ratio:${imageRisk.repeatedPagesRatio}`);
    if (imageRisk.largeImageLike) {
      reasons.add("likely_page_background_image");
    }
    if (imageRisk.fullPageLike) {
      reasons.add("full_page_slide_raster");
    }
  }
  if (!safeToRemove) {
    reasons.add(hasExecutableAnchor ? "review_required_anchor_quality" : "anchor_unreliable");
    if (group.kind === "image" && imageRisk?.fullPageLike) {
      reasons.add("unsafe_candidate_blocked");
    }
  }
  return Array.from(reasons);
}

function assessImageGroupRisk(
  group: CandidateGroup,
  pages: number[],
): {
  fullPageLike: boolean;
  largeImageLike: boolean;
  coverageRatio: number;
  repeatedPagesRatio: number;
} {
  const boxes = group.commands.map((item) => item.bbox);
  const avgCoverage =
    boxes.length > 0
      ? boxes.reduce((sum, bbox) => sum + bbox.width * bbox.height, 0) / boxes.length
      : 0;
  const fullPageLike = boxes.some(
    (bbox) =>
      bbox.width >= 0.9 &&
      bbox.height >= 0.6 &&
      bbox.x <= 0.08 &&
      bbox.y <= 0.08,
  );
  const largeImageLike = avgCoverage >= 0.55;
  const maxPage = pages.length > 0 ? Math.max(...pages) : 1;
  const repeatedPagesRatio = pages.length / Math.max(maxPage, 1);
  return {
    fullPageLike,
    largeImageLike,
    coverageRatio: round4(avgCoverage),
    repeatedPagesRatio: round4(repeatedPagesRatio),
  };
}

function collectUnsupportedReasons(candidates: CleanupCandidate[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const candidate of candidates) {
    if (candidate.safeToRemove) {
      continue;
    }
    for (const reason of candidate.reasons) {
      result[reason] = (result[reason] ?? 0) + 1;
    }
  }
  return result;
}

function buildQualityMetrics(candidates: CleanupCandidate[]): QualityMetrics {
  const anchorCount = candidates.reduce((sum, candidate) => sum + candidate.anchors.length, 0);
  const reliableAnchorCount = candidates.reduce(
    (sum, candidate) =>
      sum + candidate.anchors.filter((anchor) => anchor.reliability === "reliable").length,
    0,
  );
  const attemptedOperationCount = candidates.reduce(
    (sum, candidate) =>
      sum +
      candidate.anchors.filter((anchor) =>
        shouldExecuteAnchor({ reliability: anchor.reliability, operatorType: anchor.operatorType }),
      ).length,
    0,
  );
  return {
    candidateCount: candidates.length,
    anchorCount,
    reliableAnchorCount,
    reliableAnchorRate: anchorCount > 0 ? round4(reliableAnchorCount / anchorCount) : 0,
    attemptedOperationCount,
    appliedOperationCount: 0,
    noInstructionRemovedCount: 0,
    partialHitCandidateCount: 0,
    removalSuccessRate: 0,
    vectorAttemptedOperationCount: candidates
      .filter((candidate) => candidate.kind === "vector")
      .reduce(
        (sum, candidate) =>
          sum +
          candidate.anchors.filter((anchor) =>
            shouldExecuteAnchor({ reliability: anchor.reliability, operatorType: anchor.operatorType }),
          ).length,
        0,
      ),
    vectorAppliedOperationCount: 0,
    vectorNoInstructionRemovedCount: 0,
    vectorRemovalSuccessRate: 0,
    vectorSpanShapeMismatchCount: 0,
    vectorGraphicsDepthMismatchCount: 0,
    vectorMissingPathSegmentCount: 0,
    vectorMissingPaintSegmentCount: 0,
    vectorRequiredPaintOperatorMissingCount: 0,
    vectorSignaturePrefixMismatchCount: 0,
    vectorSignatureOperatorSequenceMismatchCount: 0,
    vectorSignatureBBoxMismatchCount: 0,
    vectorDeleteRemovedZeroCommandsCount: 0,
    vectorResidualPathLeftCount: 0,
    vectorResidualPaintLeftCount: 0,
  };
}

function pushGroup(map: Map<string, PageCommand[]>, key: string, command: PageCommand): void {
  const bucket = map.get(key) ?? [];
  bucket.push(command);
  map.set(key, bucket);
}

function pushVectorGroup(
  map: Map<string, VectorDrawingBlock[]>,
  key: string,
  block: VectorDrawingBlock,
): void {
  const bucket = map.get(key) ?? [];
  bucket.push(block);
  map.set(key, bucket);
}

function sortCommands(commands: PageCommand[]): PageCommand[] {
  return [...commands].sort((a, b) =>
    a.page === b.page ? a.commandIndex - b.commandIndex : a.page - b.page,
  );
}

function sortVectorBlocks(blocks: VectorDrawingBlock[]): VectorDrawingBlock[] {
  return [...blocks].sort((a, b) =>
    a.page === b.page ? a.commandStart - b.commandStart : a.page - b.page,
  );
}

function quantizedBbox(command: PageCommand): string {
  return [
    Math.round(command.bbox.x * 1000),
    Math.round(command.bbox.y * 1000),
    Math.round(command.bbox.width * 1000),
    Math.round(command.bbox.height * 1000),
  ].join(":");
}

function quantizedCtm(ctm: [number, number, number, number, number, number]): string {
  return ctm.map((value) => Math.round(value * 1000)).join(":");
}

function normalizeResource(value: string): string {
  return value.trim().replace(/^\//, "");
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueSortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

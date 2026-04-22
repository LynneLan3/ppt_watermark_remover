import { apiError, apiOk } from "@/lib/server/api/responses";
import { classifyApiError } from "@/lib/server/api/classify-error";
import { classifyRunnerFailure, toInternalErrorMessage } from "@/lib/server/errors/classify";
import { analyzeJob, readJobAnalysis } from "@/lib/server/jobs/service";
import type { TempJobErrorCode } from "@/lib/server/jobs/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

type AnalyzePayload = {
  totalCandidates: number;
  unsupportedPages: number[];
  notes: string[];
  candidatesByPage: Record<
    string,
    Array<{
      id?: string;
      pageNumber?: number;
      objectType?: string;
      text?: string;
      label?: string;
      normalizedBoundingBox?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      };
      boundingBox?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      };
      confidence?: number;
      repeatCount?: number;
      removability?: string;
      reasonCode?: string;
      unsupportedReasonCode?: string;
      placementHint?: string;
    }>
  >;
};

type AnalyzeData = {
  analysis: AnalyzePayload;
  supportedCandidateCount: number;
  unsupportedReasonBreakdown: Record<string, number>;
  placementBreakdown: Record<string, number>;
  recommendedCandidate: {
    id: string;
    pageNumber: number;
    objectType: string;
    confidence: number;
    placementHint: string;
    reasonCode?: string;
    reason: string;
    recommendationLabel: string;
  } | null;
  recommendationDebug?: {
    selectedPool:
      | "logo_image_supported"
      | "image_supported"
      | "non_garbled_supported"
      | "all_supported_fallback";
    hasSupportedLogoImageCandidate: boolean;
    hasAnyLogoLikeImageCandidate: boolean;
    anyLogoLikeImageStatus: "supported" | "review_required" | "unsupported" | "none";
    suppressedGarbledTextCandidateCount: number;
    topCandidates: Array<{
      id: string;
      objectType: string;
      placementHint: string;
      reasonCode?: string;
      confidence: number;
      repeatCount: number;
      score: number;
      textQuality: "human_readable" | "low_readable" | "garbled" | "not_text";
      labelPreview: string;
      suppressionReason?: string;
    }>;
  };
  limitationHint?: string;
};

export async function POST(_request: Request, { params }: Params) {
  try {
    const { jobId } = await params;
    const result = await analyzeJob(jobId);

    if (!result.runner.ok) {
      const classified = classifyRunnerFailure(result.runner);
      return apiError({
        httpStatus: toHttpStatus(classified.code),
        status: result.job.status,
        code: classified.code,
        message: classified.message,
        job: result.job,
      });
    }

    const analysis = (await readJobAnalysis(jobId)) as AnalyzePayload;
    const supportedCount = countSupportedCandidates(analysis);
    const unsupportedReasonBreakdown = collectUnsupportedReasonBreakdown(analysis);
    const placementBreakdown = collectPlacementBreakdown(analysis);
    const recommendation = pickRecommendedCandidate(analysis);
    const limitationHint = buildLimitationHint(unsupportedReasonBreakdown);

    if (supportedCount <= 0) {
      const code: TempJobErrorCode =
        (analysis.totalCandidates ?? 0) > 0 ? "unsupported_structure" : "no_candidates";
      const message =
        code === "unsupported_structure"
          ? "Analysis completed, but no supported removable structures were found."
          : "Analysis completed, but no candidates were found.";
      return apiError({
        httpStatus: 422,
        status: result.job.status,
        code,
        message,
        job: result.job,
        data: {
          analysis,
          supportedCandidateCount: supportedCount,
          unsupportedReasonBreakdown,
          placementBreakdown,
          recommendedCandidate: recommendation.recommendedCandidate,
          recommendationDebug: recommendation.recommendationDebug,
          limitationHint,
        } satisfies AnalyzeData,
      });
    }

    return apiOk({
      status: result.job.status,
      message: "Analysis completed successfully.",
      job: result.job,
      data: {
        analysis,
        supportedCandidateCount: supportedCount,
        unsupportedReasonBreakdown,
        placementBreakdown,
        recommendedCandidate: recommendation.recommendedCandidate,
        recommendationDebug: recommendation.recommendationDebug,
        limitationHint,
      },
    });
  } catch (error) {
    const classified = classifyApiError(error);
    return apiError({
      httpStatus: classified.httpStatus,
      code: classified.code,
      message: classified.message || toInternalErrorMessage(error),
    });
  }
}

function pickRecommendedCandidate(
  analysis: AnalyzePayload,
): PickRecommendationResult {
  const supported = Object.values(analysis.candidatesByPage ?? {})
    .flatMap((candidates) => candidates)
    .filter((candidate) => candidate.removability === "supported");

  if (supported.length <= 0) {
    return {
      recommendedCandidate: null,
      recommendationDebug: buildRecommendationDebug([], [], {
        selectedPool: "all_supported_fallback",
        hasSupportedLogoImageCandidate: false,
        hasAnyLogoLikeImageCandidate: false,
        anyLogoLikeImageStatus: "none",
        suppressedGarbledTextCandidateCount: 0,
      }),
    };
  }

  const scored = supported.map((candidate) => {
    const text = String(candidate.text ?? candidate.label ?? "");
    const textQuality = evaluateTextQuality(text);
    return {
      candidate,
      score: scoreCandidate(candidate, textQuality),
      textQuality,
      logoLikeImage: isLogoLikeImageCandidate(candidate),
    };
  });

  const supportedLogoImage = scored.filter(
    (item) =>
      item.logoLikeImage &&
      item.candidate.objectType === "image_xobject" &&
      item.candidate.removability === "supported",
  );
  const supportedImage = scored.filter(
    (item) =>
      item.candidate.objectType === "image_xobject" &&
      item.candidate.removability === "supported",
  );
  const nonGarbled = scored.filter((item) => !item.textQuality.isGarbled);

  let selectedPool: NonNullable<AnalyzeData["recommendationDebug"]>["selectedPool"] =
    "all_supported_fallback";
  let pool = scored;
  if (supportedLogoImage.length > 0) {
    selectedPool = "logo_image_supported";
    pool = supportedLogoImage;
  } else if (supportedImage.length > 0) {
    selectedPool = "image_supported";
    pool = supportedImage;
  } else if (nonGarbled.length > 0) {
    selectedPool = "non_garbled_supported";
    pool = nonGarbled;
  }

  const rankedPool = [...pool].sort((a, b) => b.score - a.score);
  const top = rankedPool[0]?.candidate;
  if (!top || typeof top.id !== "string" || typeof top.pageNumber !== "number") {
    return {
      recommendedCandidate: null,
      recommendationDebug: buildRecommendationDebug(scored, [], {
        selectedPool,
        hasSupportedLogoImageCandidate: supportedLogoImage.length > 0,
        hasAnyLogoLikeImageCandidate: false,
        anyLogoLikeImageStatus: "none",
        suppressedGarbledTextCandidateCount: 0,
      }),
    };
  }

  const allCandidates = Object.values(analysis.candidatesByPage ?? {}).flatMap(
    (candidates) => candidates,
  );
  const logoLikeAny = allCandidates.filter((candidate) => isLogoLikeImageCandidate(candidate));
  const anyLogoLikeImageStatus = pickLogoLikeImageStatus(logoLikeAny);

  const suppressedGarbledTextCandidateCount = scored.filter(
    (item) => item.textQuality.isGarbled && !pool.includes(item),
  ).length;

  const recommendedCandidate: NonNullable<AnalyzeData["recommendedCandidate"]> = {
    id: top.id,
    pageNumber: top.pageNumber,
    objectType: top.objectType ?? "unknown",
    confidence: Number(top.confidence ?? 0),
    placementHint: top.placementHint ?? "unknown",
    reasonCode: top.reasonCode,
    reason: describeRecommendation(top),
    recommendationLabel: describeRecommendationLabel(top),
  };

  return {
    recommendedCandidate,
    recommendationDebug: buildRecommendationDebug(scored, pool, {
      selectedPool,
      hasSupportedLogoImageCandidate: supportedLogoImage.length > 0,
      hasAnyLogoLikeImageCandidate: logoLikeAny.length > 0,
      anyLogoLikeImageStatus,
      suppressedGarbledTextCandidateCount,
    }),
  };
}

function scoreCandidate(candidate: {
  objectType?: string;
  text?: string;
  label?: string;
  placementHint?: string;
  repeatCount?: number;
  confidence?: number;
  reasonCode?: string;
}, textQuality?: TextQuality): number {
  const objectType = candidate.objectType ?? "unknown";
  const placementHint = candidate.placementHint ?? "unknown";
  const confidence = Number(candidate.confidence ?? 0);
  const repeatCount = Number(candidate.repeatCount ?? 0);
  const reasonCode = candidate.reasonCode ?? "";

  const quality = textQuality ?? evaluateTextQuality(String(candidate.text ?? candidate.label ?? ""));
  const logoLikeImage =
    objectType === "image_xobject" && isLogoLikeImageCandidate(candidate);
  const footerOrHeaderText =
    objectType === "text_run" &&
    (placementHint === "header" || placementHint === "footer");

  let score = 0;
  score += confidence * 100;
  score += repeatCount * 12;

  if (logoLikeImage) {
    score += 100;
  } else if (objectType === "image_xobject") {
    score += 40;
  }

  if (footerOrHeaderText) {
    score += 38;
  }

  if (reasonCode === "repeated_corner_logo_supported") {
    score += 30;
  } else if (reasonCode === "repeated_header_text_supported") {
    score += 20;
  } else if (reasonCode === "repeated_footer_text_supported") {
    score += 20;
  }

  if (objectType === "text_run") {
    // Aggressive suppression for unreadable text noise.
    score -= quality.noiseScore;
    if (quality.isGarbled) {
      score -= 220;
    } else if (!quality.isHumanReadable) {
      score -= 80;
    } else {
      score += 24;
    }
    if (placementHint !== "header" && placementHint !== "footer") {
      score -= 20;
    }
  }

  return score;
}

function describeRecommendation(candidate: {
  objectType?: string;
  placementHint?: string;
  reasonCode?: string;
  text?: string;
  label?: string;
}): string {
  const placement = candidate.placementHint ?? "unknown";
  if (candidate.reasonCode === "repeated_corner_logo_supported") {
    return "检测到重复角标 logo 图像，优先建议从该对象开始。";
  }
  if (candidate.reasonCode === "repeated_header_text_supported") {
    return "检测到重复页眉文本，建议优先处理该候选。";
  }
  if (candidate.reasonCode === "repeated_footer_text_supported") {
    return "检测到重复页脚文本，建议优先处理该候选。";
  }
  if (candidate.objectType === "image_xobject") {
    return `该图像候选在 ${placement} 位置重复出现，适合优先验证。`;
  }
  if (scoreTextNoise(String(candidate.text ?? candidate.label ?? "")) >= 65) {
    return "该文本候选重复出现，但文本可读性较低，建议优先检查图像类候选。";
  }
  return `该候选在 ${placement} 区域具备较高可移除信号。`;
}

function describeRecommendationLabel(candidate: {
  objectType?: string;
  placementHint?: string;
  reasonCode?: string;
}): string {
  if (candidate.reasonCode === "repeated_corner_logo_supported") {
    return "Repeated Corner Logo Candidate";
  }
  if (candidate.reasonCode === "repeated_footer_text_supported") {
    return "Repeated Footer Text Candidate";
  }
  if (candidate.reasonCode === "repeated_header_text_supported") {
    return "Repeated Header Text Candidate";
  }
  if (candidate.objectType === "image_xobject") {
    return "Repeated Image Candidate";
  }
  if (candidate.objectType === "text_run") {
    return "Repeated Text Candidate";
  }
  return "Recommended Candidate";
}

function scoreTextNoise(text: string): number {
  const raw = text.trim();
  if (!raw) {
    return 100;
  }

  const lengthPenalty = raw.length <= 2 ? 32 : raw.length <= 4 ? 18 : 0;
  const printable = raw.split("").filter((ch) => /[ -~]/.test(ch)).length;
  const printableRatio = printable / raw.length;
  const latinWordChars = raw.split("").filter((ch) => /[A-Za-z0-9]/.test(ch)).length;
  const latinRatio = latinWordChars / raw.length;
  const punct = raw.split("").filter((ch) => /[^\p{L}\p{N}\s]/u.test(ch)).length;
  const punctRatio = punct / raw.length;
  const suspiciousSequence = /[ÿÝþð]{2,}|[^\p{L}\p{N}\s]{3,}/u.test(raw) ? 1 : 0;

  let score = 0;
  score += lengthPenalty;
  score += (1 - printableRatio) * 40;
  score += (1 - latinRatio) * 18;
  score += punctRatio * 30;
  score += suspiciousSequence * 25;
  return Math.round(Math.max(0, Math.min(100, score)));
}

type TextQuality = {
  noiseScore: number;
  isHumanReadable: boolean;
  isGarbled: boolean;
};

type PickRecommendationResult = {
  recommendedCandidate: AnalyzeData["recommendedCandidate"];
  recommendationDebug: NonNullable<AnalyzeData["recommendationDebug"]>;
};

function evaluateTextQuality(text: string): TextQuality {
  const raw = text.trim();
  if (!raw) {
    return { noiseScore: 100, isHumanReadable: false, isGarbled: true };
  }
  const noiseScore = scoreTextNoise(raw);
  const printable = raw.split("").filter((ch) => /[ -~]/.test(ch)).length;
  const printableRatio = printable / raw.length;
  const suspicious = /[ÿÝþð]{2,}|[^\p{L}\p{N}\s]{3,}/u.test(raw);
  const hasWord = /[\p{L}\p{N}]{2,}/u.test(raw);
  const isHumanReadable = hasWord && printableRatio >= 0.45 && !suspicious && noiseScore < 50;
  const isGarbled =
    suspicious ||
    noiseScore >= 70 ||
    (raw.length <= 4 && !/[\p{L}\p{N}]/u.test(raw)) ||
    printableRatio < 0.25;
  return { noiseScore, isHumanReadable, isGarbled };
}

function isLogoLikeImageCandidate(candidate: {
  objectType?: string;
  placementHint?: string;
  reasonCode?: string;
  repeatCount?: number;
  normalizedBoundingBox?: { x?: number; y?: number; width?: number; height?: number };
  boundingBox?: { x?: number; y?: number; width?: number; height?: number };
}): boolean {
  if (candidate.objectType !== "image_xobject") {
    return false;
  }
  if (candidate.reasonCode === "repeated_corner_logo_supported") {
    return true;
  }
  const repeatCount = Number(candidate.repeatCount ?? 0);
  const box = candidate.normalizedBoundingBox ?? candidate.boundingBox;
  const x = Number(box?.x ?? 0);
  const y = Number(box?.y ?? 0);
  const width = Number(box?.width ?? 1);
  const height = Number(box?.height ?? 1);
  const area = Math.max(0, width) * Math.max(0, height);
  const nearLeft = x < 0.2;
  const nearRight = x + width > 0.8;
  const nearTop = y < 0.2;
  const nearBottom = y + height > 0.8;
  const nearCorner = (nearLeft || nearRight) && (nearTop || nearBottom);
  return repeatCount >= 2 && area > 0 && area < 0.12 && nearCorner;
}

function buildRecommendationDebug(
  scored: Array<{
    candidate: AnalyzePayload["candidatesByPage"][string][number];
    score: number;
    textQuality: TextQuality;
    logoLikeImage: boolean;
  }>,
  selectedPool: Array<{
    candidate: AnalyzePayload["candidatesByPage"][string][number];
    score: number;
    textQuality: TextQuality;
    logoLikeImage: boolean;
  }>,
  summary: {
    selectedPool: NonNullable<AnalyzeData["recommendationDebug"]>["selectedPool"];
    hasSupportedLogoImageCandidate: boolean;
    hasAnyLogoLikeImageCandidate: boolean;
    anyLogoLikeImageStatus: NonNullable<AnalyzeData["recommendationDebug"]>["anyLogoLikeImageStatus"];
    suppressedGarbledTextCandidateCount: number;
  },
): NonNullable<AnalyzeData["recommendationDebug"]> {
  const topCandidates = [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => {
      const inSelectedPool = selectedPool.includes(item);
      const textQuality: NonNullable<AnalyzeData["recommendationDebug"]>["topCandidates"][number]["textQuality"] =
        item.candidate.objectType !== "text_run"
          ? "not_text"
          : item.textQuality.isGarbled
            ? "garbled"
            : item.textQuality.isHumanReadable
              ? "human_readable"
              : "low_readable";
      return {
        id: String(item.candidate.id ?? ""),
        objectType: String(item.candidate.objectType ?? "unknown"),
        placementHint: String(item.candidate.placementHint ?? "unknown"),
        reasonCode: item.candidate.reasonCode,
        confidence: Number(item.candidate.confidence ?? 0),
        repeatCount: Number(item.candidate.repeatCount ?? 0),
        score: Math.round(item.score),
        textQuality,
        labelPreview:
          item.candidate.objectType === "text_run" && !item.textQuality.isHumanReadable
            ? "[low-readable-text]"
            : String(item.candidate.label ?? item.candidate.text ?? "").slice(0, 60),
        suppressionReason: inSelectedPool
          ? undefined
          : item.textQuality.isGarbled
            ? "garbled_text_suppressed"
            : summary.selectedPool === "logo_image_supported"
              ? "logo_image_pool_preferred"
              : summary.selectedPool === "image_supported"
                ? "image_pool_preferred"
                : summary.selectedPool === "non_garbled_supported"
                  ? "non_garbled_pool_preferred"
                  : undefined,
      };
    });
  return {
    ...summary,
    topCandidates,
  };
}

function pickLogoLikeImageStatus(
  candidates: Array<AnalyzePayload["candidatesByPage"][string][number]>,
): NonNullable<AnalyzeData["recommendationDebug"]>["anyLogoLikeImageStatus"] {
  if (candidates.some((candidate) => candidate.removability === "supported")) {
    return "supported";
  }
  if (candidates.some((candidate) => candidate.removability === "review_required")) {
    return "review_required";
  }
  if (candidates.some((candidate) => candidate.removability === "unsupported")) {
    return "unsupported";
  }
  return "none";
}

function buildLimitationHint(unsupportedReasonBreakdown: Record<string, number>): string | undefined {
  const largeBackground = unsupportedReasonBreakdown.large_background_image ?? 0;
  const nonRepeated = unsupportedReasonBreakdown.non_repeated_decorative_image ?? 0;
  const total = Object.values(unsupportedReasonBreakdown).reduce((sum, count) => sum + count, 0);
  if (total <= 0) {
    return undefined;
  }
  if (largeBackground + nonRepeated >= Math.max(3, Math.floor(total * 0.7))) {
    return "当前文件更接近背景烘焙导出（NotebookLM 常见），对象级清理可用性有限。";
  }
  return undefined;
}

function collectUnsupportedReasonBreakdown(
  analysis: AnalyzePayload,
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const candidates of Object.values(analysis.candidatesByPage ?? {})) {
    for (const candidate of candidates) {
      if (candidate.removability !== "supported") {
        const reason =
          candidate.unsupportedReasonCode ?? candidate.reasonCode ?? "unsupported_structure";
        breakdown[reason] = (breakdown[reason] ?? 0) + 1;
      }
    }
  }
  return breakdown;
}

function collectPlacementBreakdown(analysis: AnalyzePayload): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const candidates of Object.values(analysis.candidatesByPage ?? {})) {
    for (const candidate of candidates) {
      const placement = candidate.placementHint ?? "unknown";
      breakdown[placement] = (breakdown[placement] ?? 0) + 1;
    }
  }
  return breakdown;
}

function countSupportedCandidates(analysis: AnalyzePayload): number {
  let count = 0;
  for (const candidates of Object.values(analysis.candidatesByPage ?? {})) {
    for (const candidate of candidates) {
      if (candidate.removability === "supported") {
        count += 1;
      }
    }
  }
  return count;
}

function toHttpStatus(code: TempJobErrorCode): number {
  if (code === "runner_timeout") {
    return 504;
  }
  if (code === "unsupported_structure" || code === "no_candidates") {
    return 422;
  }
  return 500;
}

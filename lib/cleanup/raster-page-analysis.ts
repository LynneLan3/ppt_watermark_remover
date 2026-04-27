import "server-only";

import type { PageCommand } from "@/lib/cleanup/content-command-model";
import type { CleanupCandidate, JobReviewPayload } from "@/lib/jobs/types";

type RasterPageAnalysisResult = {
  documentMode: "object_level" | "raster_page";
  recommendedProcessMode: "object_level_v2" | "raster_repair_v1";
  watermarkRegionHint: "right_bottom" | "unknown";
  pageImageLikeRatio: number;
  repeatedWatermarkPages: number[];
  logoPositionStats: {
    rightBottom: number;
    rightBottomRatio: number;
    unknown: number;
  };
  rasterPageAnalysis?: NonNullable<JobReviewPayload["rasterPageAnalysis"]>;
};

const LARGE_IMAGE_COVERAGE = 0.55;
const RIGHT_BOTTOM_X = 0.74;
const RIGHT_BOTTOM_Y = 0.84;
const MARK_MAX_WIDTH = 0.24;
const MARK_MAX_HEIGHT = 0.14;

export function analyzeRasterPageMode(input: {
  pageCommands: PageCommand[];
  candidates: CleanupCandidate[];
}): RasterPageAnalysisResult {
  const pages = uniqueSorted(input.pageCommands.map((item) => item.page));
  const pageCount = pages.length;
  if (pageCount <= 0) {
    return {
      documentMode: "object_level",
      recommendedProcessMode: "object_level_v2",
      watermarkRegionHint: "unknown",
      pageImageLikeRatio: 0,
      repeatedWatermarkPages: [],
      logoPositionStats: {
        rightBottom: 0,
        rightBottomRatio: 0,
        unknown: 0,
      },
    };
  }

  const imageLikePages = detectImageLikePages(input.pageCommands);
  const imageLikePageCount = imageLikePages.size;
  const imageLikeRatio = round4(imageLikePageCount / pageCount);

  const repeatedWatermarkPages = detectRepeatedBottomRightWatermarkPages(input.candidates);
  const repeatedBottomRightMarkPages = repeatedWatermarkPages.length;
  const repeatedBottomRightMarkRatio = round4(repeatedBottomRightMarkPages / pageCount);

  const fullPageRasterSignalCount = input.candidates.filter(
    (candidate) =>
      candidate.kind === "image" &&
      candidate.reasons.some(
        (reason) => reason === "full_page_slide_raster" || reason === "likely_page_background_image",
      ),
  ).length;

  const logoPositionStats = {
    rightBottom: repeatedBottomRightMarkPages,
    rightBottomRatio: repeatedBottomRightMarkRatio,
    unknown: Math.max(0, repeatedBottomRightMarkPages - repeatedBottomRightMarkPages),
  };

  const isRasterPage =
    imageLikeRatio >= 0.7 &&
    (repeatedBottomRightMarkRatio >= 0.35 ||
      fullPageRasterSignalCount >= Math.max(2, Math.ceil(pageCount * 0.5)));

  if (!isRasterPage) {
    return {
      documentMode: "object_level",
      recommendedProcessMode: "object_level_v2",
      watermarkRegionHint: repeatedBottomRightMarkPages > 0 ? "right_bottom" : "unknown",
      pageImageLikeRatio: imageLikeRatio,
      repeatedWatermarkPages,
      logoPositionStats,
    };
  }

  return {
    documentMode: "raster_page",
    recommendedProcessMode: "raster_repair_v1",
    watermarkRegionHint: "right_bottom",
    pageImageLikeRatio: imageLikeRatio,
    repeatedWatermarkPages,
    logoPositionStats,
    rasterPageAnalysis: {
      pageCount,
      imageLikePageCount,
      imageLikeRatio,
      repeatedBottomRightMarkPages,
      repeatedBottomRightMarkRatio,
      watermarkRegionHint: "right_bottom",
      recommendedProcessMode: "raster_repair_v1",
      fullPageRasterSignalCount,
      pageImageLikeRatio: imageLikeRatio,
      repeatedWatermarkPages,
      logoPositionStats,
    },
  };
}

function detectImageLikePages(commands: PageCommand[]): Set<number> {
  const pageToLargeImage = new Set<number>();
  for (const command of commands) {
    if (command.operatorType !== "xobject_do") {
      continue;
    }
    const coverage = command.bbox.width * command.bbox.height;
    if (coverage >= LARGE_IMAGE_COVERAGE || (command.bbox.width >= 0.9 && command.bbox.height >= 0.6)) {
      pageToLargeImage.add(command.page);
    }
  }
  return pageToLargeImage;
}

function detectRepeatedBottomRightWatermarkPages(candidates: CleanupCandidate[]): number[] {
  const pages = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.repeatedCount < 2) {
      continue;
    }
    for (const sample of candidate.bboxSamples) {
      const inRightBottom =
        sample.x >= RIGHT_BOTTOM_X &&
        sample.y >= RIGHT_BOTTOM_Y &&
        sample.width <= MARK_MAX_WIDTH &&
        sample.height <= MARK_MAX_HEIGHT;
      if (inRightBottom) {
        pages.add(sample.page);
      }
    }
  }
  return uniqueSorted(Array.from(pages));
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function round4(value: number): number {
  return Number(value.toFixed(4));
}

import type { CleanupScope, NormalizedRect } from "@/lib/local/pdf/types";

export function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const width = clamp01(rect.width);
  const height = clamp01(rect.height);

  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

export function resolveTargetPages(
  scope: CleanupScope,
  currentPage: number,
  pageCount: number,
  rangeStart?: number,
  rangeEnd?: number,
): number[] {
  if (pageCount < 1) {
    throw new Error("No pages are available.");
  }

  if (scope === "all") {
    return Array.from({ length: pageCount }, (_, idx) => idx + 1);
  }

  if (scope === "current") {
    validatePage(currentPage, pageCount, "Current page is out of range.");
    return [currentPage];
  }

  const start = rangeStart ?? 1;
  const end = rangeEnd ?? pageCount;
  validatePage(start, pageCount, "Range start is out of range.");
  validatePage(end, pageCount, "Range end is out of range.");

  if (start > end) {
    throw new Error("Range start must be less than or equal to range end.");
  }

  return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
}

function validatePage(page: number, pageCount: number, message: string) {
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    throw new Error(message);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

import { OPS, type PDFDocumentProxy } from "pdfjs-dist";

import type {
  PdfCandidateAnalysisResult,
  PdfObjectCandidate,
  PdfObjectType,
  Removability,
} from "@/lib/local/pdf/types";

const MAX_CANDIDATES_PER_PAGE = 40;

type Matrix = [number, number, number, number, number, number];

type CandidateSeed = {
  id: string;
  pageNumber: number;
  objectType: Exclude<PdfObjectType, "repeated_overlay" | "unsupported_region">;
  normalizedBoundingBox: PdfObjectCandidate["normalizedBoundingBox"];
  confidence: number;
  label: string;
  repeatKey: string;
  reasons: string[];
};

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export async function analyzePdfCandidates(
  pdfDoc: PDFDocumentProxy,
): Promise<PdfCandidateAnalysisResult> {
  const rawCandidates: CandidateSeed[] = [];
  const unsupportedPages = new Set<number>();
  const notes = [
    "Browser analysis is preview-only and identifies likely independent objects for engine-side deletion.",
    "True object-level deletion must be executed by a dedicated PDF editor (pikepdf/PyMuPDF).",
  ];

  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });

    const textCandidates = await extractTextCandidates(
      pageNumber,
      page,
      viewport.width,
      viewport.height,
    );
    const imageAndFormCandidates = await extractImageAndFormCandidates(
      pageNumber,
      page,
      viewport.width,
      viewport.height,
    );

    const pageCandidates = [...textCandidates, ...imageAndFormCandidates]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CANDIDATES_PER_PAGE);

    if (looksFlattenedPage(pageCandidates)) {
      unsupportedPages.add(pageNumber);
    }

    rawCandidates.push(...pageCandidates);
  }

  const withRepeatMeta = attachRepeatMeta(rawCandidates);
  const repeatedOverlays = buildRepeatedOverlayCandidates(withRepeatMeta);
  const unsupportedRegionCandidates = buildUnsupportedRegionCandidates(unsupportedPages);
  const allCandidates = [...withRepeatMeta, ...repeatedOverlays, ...unsupportedRegionCandidates];

  return {
    candidatesByPage: groupCandidatesByPage(allCandidates),
    totalCandidates: allCandidates.length,
    unsupportedPages: Array.from(unsupportedPages).sort((a, b) => a - b),
    notes,
  };
}

async function extractTextCandidates(
  pageNumber: number,
  page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>,
  pageWidth: number,
  pageHeight: number,
): Promise<CandidateSeed[]> {
  const textContent = await page.getTextContent();
  const candidates: CandidateSeed[] = [];

  let index = 0;
  for (const item of textContent.items as Array<{
    str?: string;
    transform?: number[];
    width?: number;
    height?: number;
  }>) {
    if (!item.transform || !item.str?.trim()) {
      continue;
    }

    const [a, , , d, e, f] = item.transform;
    const width = Math.abs(item.width ?? a ?? 0);
    const height = Math.max(6, Math.abs(item.height ?? d ?? 0));
    if (width < 2 || height < 2) {
      continue;
    }

    const x = clamp(e / pageWidth, 0, 1);
    const y = clamp((pageHeight - f - height) / pageHeight, 0, 1);
    const normalizedWidth = clamp(width / pageWidth, 0, 1 - x);
    const normalizedHeight = clamp(height / pageHeight, 0, 1 - y);
    if (normalizedWidth <= 0 || normalizedHeight <= 0) {
      continue;
    }

    const compactText = item.str.trim().slice(0, 60);
    const nearTopOrBottom = y < 0.2 || y + normalizedHeight > 0.8;
    const area = normalizedWidth * normalizedHeight;
    const smallObject = area < 0.05;

    const confidence = clamp(
      0.4 + (nearTopOrBottom ? 0.2 : 0) + (smallObject ? 0.1 : 0) + Math.min(0.15, compactText.length * 0.005),
      0.1,
      0.95,
    );

    const repeatKey = [
      "text_run",
      normalizeTextKey(compactText),
      quantize(x),
      quantize(y),
      quantize(normalizedWidth),
      quantize(normalizedHeight),
    ].join(":");

    candidates.push({
      id: `text-run-${pageNumber}-${index}`,
      pageNumber,
      objectType: "text_run",
      normalizedBoundingBox: {
        x,
        y,
        width: normalizedWidth,
        height: normalizedHeight,
      },
      confidence,
      label: compactText,
      repeatKey,
      reasons: [
        "Detected as independent text content in the PDF text layer.",
        nearTopOrBottom
          ? "Located near header/footer region where repeated marks are common."
          : "Located in a regular content zone; verify before deletion.",
      ],
    });
    index += 1;
  }

  return candidates;
}

async function extractImageAndFormCandidates(
  pageNumber: number,
  page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>,
  pageWidth: number,
  pageHeight: number,
): Promise<CandidateSeed[]> {
  const opList = await page.getOperatorList();
  const candidates: CandidateSeed[] = [];

  let currentTransform: Matrix = [...IDENTITY_MATRIX];
  const transformStack: Matrix[] = [];
  let imageIndex = 0;
  let formIndex = 0;

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (fn === OPS.save) {
      transformStack.push([...currentTransform] as Matrix);
      continue;
    }
    if (fn === OPS.restore) {
      currentTransform = transformStack.pop() ?? [...IDENTITY_MATRIX];
      continue;
    }
    if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
      const next: Matrix = [
        Number(args[0]),
        Number(args[1]),
        Number(args[2]),
        Number(args[3]),
        Number(args[4]),
        Number(args[5]),
      ];
      currentTransform = multiplyMatrices(currentTransform, next);
      continue;
    }

    const isImagePaint =
      fn === OPS.paintImageXObject ||
      fn === OPS.paintInlineImageXObject ||
      fn === OPS.paintImageMaskXObject;
    const isFormPaint = fn === OPS.paintFormXObjectBegin;

    if (!isImagePaint && !isFormPaint) {
      continue;
    }

    const bbox = transformToNormalizedBoundingBox(currentTransform, pageWidth, pageHeight);
    if (!bbox) {
      continue;
    }

    const area = bbox.width * bbox.height;
    const nearTopOrBottom = bbox.y < 0.2 || bbox.y + bbox.height > 0.8;
    const objectType: CandidateSeed["objectType"] = isFormPaint
      ? "form_xobject"
      : "image_xobject";

    const baseConfidence = isFormPaint ? 0.5 : 0.42;
    const confidence = clamp(
      baseConfidence + (area < 0.08 && nearTopOrBottom ? 0.22 : 0) - (area > 0.7 ? 0.28 : 0),
      0.1,
      0.9,
    );

    const repeatKey = [
      objectType,
      quantize(bbox.x),
      quantize(bbox.y),
      quantize(bbox.width),
      quantize(bbox.height),
    ].join(":");

    const label =
      area > 0.7
        ? "Large background-like object"
        : isFormPaint
          ? "Form XObject candidate"
          : "Image XObject candidate";

    candidates.push({
      id: `${objectType}-${pageNumber}-${isFormPaint ? formIndex : imageIndex}`,
      pageNumber,
      objectType,
      normalizedBoundingBox: bbox,
      confidence,
      label,
      repeatKey,
      reasons: [
        isFormPaint
          ? "Detected through PDF form XObject paint operation."
          : "Detected through PDF image paint operation.",
        area > 0.7
          ? "Covers most of the page and may indicate flattened/background content."
          : "Object size is constrained and could be independently removable.",
      ],
    });

    if (isFormPaint) {
      formIndex += 1;
    } else {
      imageIndex += 1;
    }
  }

  return candidates;
}

function transformToNormalizedBoundingBox(
  currentTransform: Matrix,
  pageWidth: number,
  pageHeight: number,
): PdfObjectCandidate["normalizedBoundingBox"] | null {
  const corners = [
    transformPoint(currentTransform, 0, 0),
    transformPoint(currentTransform, 1, 0),
    transformPoint(currentTransform, 0, 1),
    transformPoint(currentTransform, 1, 1),
  ];

  const minX = Math.min(...corners.map((p) => p.x));
  const maxX = Math.max(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxY = Math.max(...corners.map((p) => p.y));

  const x = clamp(minX / pageWidth, 0, 1);
  const y = clamp((pageHeight - maxY) / pageHeight, 0, 1);
  const width = clamp((maxX - minX) / pageWidth, 0, 1 - x);
  const height = clamp((maxY - minY) / pageHeight, 0, 1 - y);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { x, y, width, height };
}

function looksFlattenedPage(pageCandidates: CandidateSeed[]): boolean {
  const hasLargeBackgroundLikeObject = pageCandidates.some(
    (candidate) =>
      candidate.objectType !== "text_run" &&
      candidate.normalizedBoundingBox.width * candidate.normalizedBoundingBox.height > 0.82,
  );
  const hasOnlyFewSelectableObjects = pageCandidates.length <= 2;
  return hasLargeBackgroundLikeObject && hasOnlyFewSelectableObjects;
}

function attachRepeatMeta(candidates: CandidateSeed[]): PdfObjectCandidate[] {
  const repeatCounts = new Map<string, number>();
  for (const candidate of candidates) {
    repeatCounts.set(candidate.repeatKey, (repeatCounts.get(candidate.repeatKey) ?? 0) + 1);
  }

  return candidates.map((candidate) => {
    const repeatCount = repeatCounts.get(candidate.repeatKey) ?? 1;
    const repeatBonus = Math.min(0.2, (repeatCount - 1) * 0.05);
    const confidence = clamp(candidate.confidence + repeatBonus, 0.1, 0.95);

    const area =
      candidate.normalizedBoundingBox.width * candidate.normalizedBoundingBox.height;
    const removability = classifyRemovability(candidate.objectType, area, repeatCount, confidence);

    const reasons = [...candidate.reasons];
    if (repeatCount > 1) {
      reasons.push(`Detected on ${repeatCount} pages with matching repeat key.`);
    }
    reasons.push(removabilityExplanation(removability));

    return withComputedRects({
      id: candidate.id,
      pageNumber: candidate.pageNumber,
      objectType: candidate.objectType,
      normalizedBoundingBox: candidate.normalizedBoundingBox,
      confidence,
      label: candidate.label,
      key: `${candidate.repeatKey}:p${candidate.pageNumber}`,
      repeatKey: candidate.repeatKey,
      repeatCount,
      removability,
      reasons,
    });
  });
}

function buildRepeatedOverlayCandidates(
  candidates: PdfObjectCandidate[],
): PdfObjectCandidate[] {
  const overlays: PdfObjectCandidate[] = [];
  let overlayIndex = 0;

  for (const candidate of candidates) {
    const area =
      candidate.normalizedBoundingBox.width * candidate.normalizedBoundingBox.height;
    if (candidate.repeatCount < 2 || area > 0.12 || candidate.removability === "unsupported") {
      continue;
    }

    overlays.push({
      ...candidate,
      id: `repeated-overlay-${candidate.pageNumber}-${overlayIndex}`,
      objectType: "repeated_overlay",
      confidence: clamp(candidate.confidence + 0.1, 0.1, 0.95),
      label: `Repeated overlay (${candidate.label})`,
      key: `repeated_overlay:${candidate.key}`,
      removability: "supported",
      reasons: [
        "Derived candidate: repeated small object likely used as logo/header/footer mark.",
        `Links to repeat key: ${candidate.repeatKey}`,
      ],
    });
    overlayIndex += 1;
  }

  return overlays;
}

function buildUnsupportedRegionCandidates(
  unsupportedPages: Set<number>,
): PdfObjectCandidate[] {
  return Array.from(unsupportedPages).map((pageNumber) =>
    withComputedRects({
      id: `unsupported-region-${pageNumber}`,
      pageNumber,
      objectType: "unsupported_region",
      normalizedBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
      confidence: 0.2,
      label: "Likely flattened page background",
      key: `unsupported_region:p${pageNumber}`,
      repeatKey: `unsupported_region:p${pageNumber}`,
      repeatCount: 1,
      removability: "unsupported",
      reasons: [
        "Page appears flattened and may not expose removable independent objects.",
        "Avoid destructive white-rectangle cover-up for this target.",
      ],
    }),
  );
}

function withComputedRects(candidate: {
  id: string;
  pageNumber: number;
  objectType: PdfObjectCandidate["objectType"];
  normalizedBoundingBox: PdfObjectCandidate["normalizedBoundingBox"];
  repeatCount: number;
  confidence: number;
  label: string;
  key: string;
  repeatKey: string;
  removability: Removability;
  reasons: string[];
}): PdfObjectCandidate {
  return {
    ...candidate,
    boundingBox: {
      x: candidate.normalizedBoundingBox.x,
      y: candidate.normalizedBoundingBox.y,
      width: candidate.normalizedBoundingBox.width,
      height: candidate.normalizedBoundingBox.height,
    },
  };
}

function classifyRemovability(
  objectType: CandidateSeed["objectType"],
  area: number,
  repeatCount: number,
  confidence: number,
): Removability {
  if (area > 0.75 && objectType !== "text_run") {
    return "unsupported";
  }

  if (confidence >= 0.65 && (repeatCount > 1 || area < 0.1)) {
    return "supported";
  }

  return "review_required";
}

function removabilityExplanation(removability: Removability): string {
  if (removability === "supported") {
    return "Independent object signal is strong; object-level deletion is likely feasible.";
  }
  if (removability === "unsupported") {
    return "Independent object signal is weak; target may be baked into background content.";
  }
  return "Candidate may be removable but needs manual verification in a dedicated PDF engine.";
}

function groupCandidatesByPage(
  candidates: PdfObjectCandidate[],
): Record<number, PdfObjectCandidate[]> {
  const byPage: Record<number, PdfObjectCandidate[]> = {};
  for (const candidate of candidates) {
    const bucket = byPage[candidate.pageNumber] ?? [];
    bucket.push(candidate);
    byPage[candidate.pageNumber] = bucket;
  }

  for (const page of Object.keys(byPage)) {
    const pageNumber = Number(page);
    byPage[pageNumber] = byPage[pageNumber]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_CANDIDATES_PER_PAGE);
  }

  return byPage;
}

function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function transformPoint(matrix: Matrix, x: number, y: number) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function normalizeTextKey(input: string) {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function quantize(value: number) {
  return Math.round(value * 20) / 20;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

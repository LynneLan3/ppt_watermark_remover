import "server-only";

import type { CandidateBBox } from "@/lib/jobs/types";

export type PageCommand = {
  page: number;
  commandIndex: number;
  operatorName: string;
  operatorType: "xobject_do" | "vector_paint" | "text_show" | "text_block";
  operandsRaw: string;
  resourceName: string;
  ctm: [number, number, number, number, number, number];
  graphicsDepth: number;
  textBlockId?: string;
  fontName?: string;
  fontSize?: number;
  decodedText?: string;
  normalizedText?: string;
  bbox: CandidateBBox;
  commandWindowBefore?: string[];
  commandWindowAfter?: string[];
  strokeColor?: string;
  fillColor?: string;
  lineWidth?: number;
  textMatrix?: [number, number, number, number, number, number];
  textLineMatrix?: [number, number, number, number, number, number];
  inlineImageInfo?: {
    width?: number;
    height?: number;
    colorSpace?: string;
    bitsPerComponent?: number;
  };
};

export type PageCommandsPayload = {
  version: string;
  generatedAt: string;
  sourcePdfPath: string;
  pageCommands: PageCommand[];
};

export function parsePageCommandsPayload(raw: unknown): PageCommandsPayload {
  const payload = raw as Partial<PageCommandsPayload> | null;
  const commands = Array.isArray(payload?.pageCommands) ? payload?.pageCommands : [];
  return {
    version: typeof payload?.version === "string" ? payload.version : "v1",
    generatedAt: typeof payload?.generatedAt === "string" ? payload.generatedAt : new Date().toISOString(),
    sourcePdfPath: typeof payload?.sourcePdfPath === "string" ? payload.sourcePdfPath : "",
    pageCommands: commands
      .map((command) => normalizePageCommand(command))
      .filter((command): command is PageCommand => Boolean(command))
      .sort((a, b) => (a.page === b.page ? a.commandIndex - b.commandIndex : a.page - b.page)),
  };
}

export function groupCommandsByPage(commands: PageCommand[]): Map<number, PageCommand[]> {
  const map = new Map<number, PageCommand[]>();
  for (const command of commands) {
    const bucket = map.get(command.page) ?? [];
    bucket.push(command);
    map.set(command.page, bucket);
  }
  return map;
}

function normalizePageCommand(raw: unknown): PageCommand | null {
  const row = raw as Partial<PageCommand> | null;
  if (!row || typeof row !== "object") {
    return null;
  }
  const page = Number(row.page);
  const commandIndex = Number(row.commandIndex);
  if (!Number.isInteger(page) || page <= 0 || !Number.isInteger(commandIndex) || commandIndex < 0) {
    return null;
  }
  const operatorType = normalizeOperatorType(row.operatorType);
  if (!operatorType) {
    return null;
  }
  return {
    page,
    commandIndex,
    operatorName: String(row.operatorName ?? ""),
    operatorType,
    operandsRaw: String(row.operandsRaw ?? ""),
    resourceName: String(row.resourceName ?? ""),
    ctm: normalizeCtm(row.ctm),
    graphicsDepth: Number.isFinite(Number(row.graphicsDepth)) ? Number(row.graphicsDepth) : 0,
    textBlockId: row.textBlockId ? String(row.textBlockId) : undefined,
    fontName: row.fontName ? String(row.fontName) : undefined,
    fontSize: Number.isFinite(Number(row.fontSize)) ? Number(row.fontSize) : undefined,
    decodedText: row.decodedText ? String(row.decodedText) : undefined,
    normalizedText: row.normalizedText ? String(row.normalizedText) : undefined,
    bbox: normalizeBbox(row.bbox),
    commandWindowBefore: Array.isArray(row.commandWindowBefore)
      ? row.commandWindowBefore.map((item) => String(item))
      : undefined,
    commandWindowAfter: Array.isArray(row.commandWindowAfter)
      ? row.commandWindowAfter.map((item) => String(item))
      : undefined,
    strokeColor: row.strokeColor ? String(row.strokeColor) : undefined,
    fillColor: row.fillColor ? String(row.fillColor) : undefined,
    lineWidth: Number.isFinite(Number(row.lineWidth)) ? Number(row.lineWidth) : undefined,
    textMatrix: normalizeOptionalMatrix(row.textMatrix),
    textLineMatrix: normalizeOptionalMatrix(row.textLineMatrix),
    inlineImageInfo:
      row.inlineImageInfo && typeof row.inlineImageInfo === "object"
        ? {
            width: Number.isFinite(Number(row.inlineImageInfo.width))
              ? Number(row.inlineImageInfo.width)
              : undefined,
            height: Number.isFinite(Number(row.inlineImageInfo.height))
              ? Number(row.inlineImageInfo.height)
              : undefined,
            colorSpace: row.inlineImageInfo.colorSpace
              ? String(row.inlineImageInfo.colorSpace)
              : undefined,
            bitsPerComponent: Number.isFinite(Number(row.inlineImageInfo.bitsPerComponent))
              ? Number(row.inlineImageInfo.bitsPerComponent)
              : undefined,
          }
        : undefined,
  };
}

function normalizeOperatorType(value: unknown): PageCommand["operatorType"] | null {
  if (
    value === "xobject_do" ||
    value === "vector_paint" ||
    value === "text_show" ||
    value === "text_block"
  ) {
    return value;
  }
  return null;
}

function normalizeBbox(input: unknown): CandidateBBox {
  const box = (input ?? {}) as Partial<CandidateBBox>;
  return {
    x: clamp01(Number(box.x ?? 0)),
    y: clamp01(Number(box.y ?? 0)),
    width: clamp01(Number(box.width ?? 0)),
    height: clamp01(Number(box.height ?? 0)),
  };
}

function normalizeCtm(value: unknown): [number, number, number, number, number, number] {
  if (Array.isArray(value) && value.length === 6) {
    return [
      safeNumber(value[0], 1),
      safeNumber(value[1], 0),
      safeNumber(value[2], 0),
      safeNumber(value[3], 1),
      safeNumber(value[4], 0),
      safeNumber(value[5], 0),
    ];
  }
  return [1, 0, 0, 1, 0, 0];
}

function normalizeOptionalMatrix(value: unknown):
  | [number, number, number, number, number, number]
  | undefined {
  if (!Array.isArray(value) || value.length !== 6) {
    return undefined;
  }
  return [
    safeNumber(value[0], 1),
    safeNumber(value[1], 0),
    safeNumber(value[2], 0),
    safeNumber(value[3], 1),
    safeNumber(value[4], 0),
    safeNumber(value[5], 0),
  ];
}

function safeNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

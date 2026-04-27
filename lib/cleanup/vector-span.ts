import "server-only";

import type { CandidateBBox } from "@/lib/jobs/types";
import type { PageCommand } from "@/lib/cleanup/content-command-model";

export type VectorDrawingBlock = {
  blockId: string;
  page: number;
  commandStart: number;
  commandEnd: number;
  pathStart: number;
  pathEnd: number;
  paintStart: number;
  paintEnd: number;
  graphicsDepth: number;
  bbox: CandidateBBox;
  paintOperators: string[];
  pathOperators: string[];
  stateOperators: string[];
  spanShapeSignature: string;
  patternSignature: string;
};

const PATH_OPERATORS = new Set(["m", "l", "c", "v", "y", "h", "re"]);
const PAINT_OPERATORS = new Set(["S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n", "W", "W*"]);
const STATE_OPERATORS = new Set(["cm", "w", "J", "j", "M", "d", "ri", "i", "gs", "RG", "G", "K", "rg", "g", "k"]);
const HARD_BOUNDARY_OPERATORS = new Set(["q", "Q", "BT", "ET", "Do"]);

export function extractVectorDrawingBlocks(pageCommands: PageCommand[]): VectorDrawingBlock[] {
  const byPage = new Map<number, PageCommand[]>();
  for (const command of pageCommands) {
    const bucket = byPage.get(command.page) ?? [];
    bucket.push(command);
    byPage.set(command.page, bucket);
  }

  const blocks: VectorDrawingBlock[] = [];
  for (const [page, commands] of byPage.entries()) {
    const sorted = [...commands].sort((a, b) => a.commandIndex - b.commandIndex);
    const consumedPaint = new Set<number>();
    for (let idx = 0; idx < sorted.length; idx += 1) {
      const command = sorted[idx];
      if (!isPaint(command.operatorName) || consumedPaint.has(idx)) {
        continue;
      }
      const block = buildVectorBlock(page, sorted, idx, consumedPaint);
      if (block) {
        blocks.push(block);
      }
    }
  }

  return blocks.sort((a, b) => (a.page === b.page ? a.commandStart - b.commandStart : a.page - b.page));
}

function buildVectorBlock(
  page: number,
  commands: PageCommand[],
  paintPos: number,
  consumedPaint: Set<number>,
): VectorDrawingBlock | null {
  const paintDepth = commands[paintPos].graphicsDepth;
  const paintStartPos = paintPos;
  let paintEndPos = paintPos;
  while (paintEndPos + 1 < commands.length) {
    const next = commands[paintEndPos + 1];
    if (next.graphicsDepth !== paintDepth || !isPaint(next.operatorName)) {
      break;
    }
    paintEndPos += 1;
  }
  for (let i = paintStartPos; i <= paintEndPos; i += 1) {
    consumedPaint.add(i);
  }

  let cursor = paintStartPos - 1;
  let pathStartPos = -1;
  let pathEndPos = -1;
  const statePositions: number[] = [];

  while (cursor >= 0) {
    const current = commands[cursor];
    if (current.graphicsDepth !== paintDepth || HARD_BOUNDARY_OPERATORS.has(current.operatorName)) {
      break;
    }
    if (isPath(current.operatorName)) {
      pathStartPos = cursor;
      if (pathEndPos < 0) {
        pathEndPos = cursor;
      }
      cursor -= 1;
      continue;
    }
    if (isState(current.operatorName)) {
      if (pathStartPos >= 0 && statePositions.length < 4) {
        statePositions.push(cursor);
        pathStartPos = cursor;
        cursor -= 1;
        continue;
      }
      if (pathStartPos < 0) {
        cursor -= 1;
        continue;
      }
    }
    break;
  }

  if (pathStartPos < 0 || pathEndPos < 0) {
    pathStartPos = paintStartPos;
    pathEndPos = paintStartPos;
  }

  const commandStartPos = Math.min(pathStartPos, paintStartPos);
  const commandEndPos = paintEndPos;
  const span = commands.slice(commandStartPos, commandEndPos + 1);
  const pathOperators = span
    .filter((command) => isPath(command.operatorName))
    .map((command) => command.operatorName);
  const paintOperators = span
    .filter((command) => isPaint(command.operatorName))
    .map((command) => command.operatorName);
  const stateOperators = span
    .filter((command) => isState(command.operatorName))
    .map((command) => command.operatorName);

  const bbox = unionBbox(span.map((command) => command.bbox));
  const pathStart = commands[pathStartPos]?.commandIndex ?? commands[paintStartPos].commandIndex;
  const pathEnd = commands[pathEndPos]?.commandIndex ?? commands[paintStartPos].commandIndex;
  const paintStart = commands[paintStartPos].commandIndex;
  const paintEnd = commands[paintEndPos].commandIndex;
  const commandStart = commands[commandStartPos].commandIndex;
  const commandEnd = commands[commandEndPos].commandIndex;
  const patternSignature = `${pathOperators.join(",")}|${paintOperators.join(",")}|d:${paintDepth}|pc:${pathOperators.length}|sc:${stateOperators.length}|mc:${paintOperators.length}`;
  const spanShapeSignature = `${patternSignature}|bbox:${quantizedBbox(bbox)}`;

  return {
    blockId: `vb-${page}-${paintStart}`,
    page,
    commandStart,
    commandEnd,
    pathStart,
    pathEnd,
    paintStart,
    paintEnd,
    graphicsDepth: paintDepth,
    bbox,
    paintOperators,
    pathOperators,
    stateOperators,
    spanShapeSignature,
    patternSignature,
  };
}

function unionBbox(boxes: CandidateBBox[]): CandidateBBox {
  if (boxes.length <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return {
    x: clamp01(minX),
    y: clamp01(minY),
    width: clamp01(maxX - minX),
    height: clamp01(maxY - minY),
  };
}

function quantizedBbox(box: CandidateBBox): string {
  return [
    Math.round(box.x * 1000),
    Math.round(box.y * 1000),
    Math.round(box.width * 1000),
    Math.round(box.height * 1000),
  ].join(":");
}

function isPath(operatorName: string): boolean {
  return PATH_OPERATORS.has(operatorName);
}

function isPaint(operatorName: string): boolean {
  return PAINT_OPERATORS.has(operatorName);
}

function isState(operatorName: string): boolean {
  return STATE_OPERATORS.has(operatorName);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

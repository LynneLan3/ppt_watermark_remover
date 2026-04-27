import "server-only";

import type { CandidateBBox, CleanupCandidate } from "@/lib/jobs/types";
import type { PageCommand } from "@/lib/cleanup/content-command-model";

export type TextFingerprint = {
  normalizedText: string;
  fontName: string;
  fontSize: number;
  quantizedPosition: string;
  blockLocalOrder: number;
  repeatedPageSet: number[];
};

export function buildTextFingerprint(params: {
  command: PageCommand;
  candidate: Pick<CleanupCandidate, "pages">;
  blockLocalOrder: number;
}): TextFingerprint {
  return {
    normalizedText: params.command.normalizedText ?? "",
    fontName: params.command.fontName ?? "unknown-font",
    fontSize: Number((params.command.fontSize ?? 0).toFixed(2)),
    quantizedPosition: quantizePosition(params.command.bbox),
    blockLocalOrder: params.blockLocalOrder,
    repeatedPageSet: [...params.candidate.pages].sort((a, b) => a - b),
  };
}

function quantizePosition(bbox: CandidateBBox): string {
  const qx = Math.round(bbox.x * 1000);
  const qy = Math.round(bbox.y * 1000);
  const qw = Math.round(bbox.width * 1000);
  const qh = Math.round(bbox.height * 1000);
  return `${qx}:${qy}:${qw}:${qh}`;
}

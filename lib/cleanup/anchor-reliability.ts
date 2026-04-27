import "server-only";

import type { CandidateAnchor, CleanupCandidate } from "@/lib/jobs/types";
import type { PageCommand } from "@/lib/cleanup/content-command-model";

export function classifyAnchorReliability(params: {
  candidate: Pick<CleanupCandidate, "kind" | "repeatedCount" | "confidence" | "safeToRemove">;
  command: PageCommand;
  hasValidRange: boolean;
}): CandidateAnchor["reliability"] {
  const { candidate, command, hasValidRange } = params;
  if (!candidate.safeToRemove) {
    return "weak";
  }
  if (candidate.kind === "text") {
    if (!hasValidRange || !command.normalizedText || command.normalizedText.length <= 0) {
      return "weak";
    }
    if (
      candidate.repeatedCount >= 2 &&
      candidate.confidence >= 0.72 &&
      command.fontSize !== undefined &&
      command.fontSize > 0
    ) {
      return "reliable";
    }
    return "probable";
  }

  if (candidate.kind === "image") {
    if (command.resourceName && !command.resourceName.startsWith("UNKNOWN_") && candidate.confidence >= 0.7) {
      return "reliable";
    }
    if (candidate.confidence >= 0.58 && candidate.repeatedCount >= 2) {
      return "probable";
    }
    return "weak";
  }

  // vector
  if (hasValidRange && command.graphicsDepth >= 1 && candidate.confidence >= 0.68) {
    return "reliable";
  }
  if (hasValidRange && candidate.repeatedCount >= 2 && candidate.confidence >= 0.55) {
    return "probable";
  }
  return "weak";
}

export function shouldExecuteAnchor(anchor: Pick<CandidateAnchor, "reliability" | "operatorType">): boolean {
  if (anchor.reliability === "weak") {
    return false;
  }
  if (anchor.operatorType === "text_show" || anchor.operatorType === "text_block") {
    return anchor.reliability === "reliable";
  }
  return true;
}

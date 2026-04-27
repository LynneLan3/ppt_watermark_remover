import type {
  CleanupCandidate,
  ImageSkipReason,
  ImageSkipSubtype,
  ImageSkippedSummary,
  JobSelectionItem,
  ProcessReportV2,
  ProcessSkipReport,
} from "@/lib/jobs/types";

const IMAGE_SKIP_REASONS: ImageSkipReason[] = [
  "full_page_candidate_blocked",
  "unsafe_candidate_blocked",
  "operator_mismatch",
  "resource_name_mismatch",
  "no_instruction_removed",
  "delete_pass_removed_zero_commands",
];

export function buildImageSkippedSummary(input: {
  processReport: ProcessReportV2 | null;
  candidates: CleanupCandidate[];
  candidateId?: string;
}): ImageSkippedSummary {
  const byReason = buildEmptyReasonCounter();
  const bySubtype: Record<string, number> = {};
  const candidateCounter = new Map<
    string,
    {
      skipCount: number;
      byReason: Record<ImageSkipReason, number>;
      bySubtype: Record<string, number>;
    }
  >();

  const skippedRows = collectImageSkippedRows({
    processReport: input.processReport,
    candidates: input.candidates,
    candidateId: input.candidateId,
  });
  for (const row of skippedRows) {
    const normalizedReason = normalizeImageSkipReason(row);
    byReason[normalizedReason] += 1;
    const subtype = normalizeImageSkipSubtype(row, normalizedReason) ?? "unknown";
    bySubtype[subtype] = (bySubtype[subtype] ?? 0) + 1;

    const entry = candidateCounter.get(row.candidateId) ?? {
      skipCount: 0,
      byReason: buildEmptyReasonCounter(),
      bySubtype: {},
    };
    entry.skipCount += 1;
    entry.byReason[normalizedReason] += 1;
    entry.bySubtype[subtype] = (entry.bySubtype[subtype] ?? 0) + 1;
    candidateCounter.set(row.candidateId, entry);
  }

  const topAffectedCandidates = Array.from(candidateCounter.entries())
    .map(([candidateId, item]) => ({
      candidateId,
      skipCount: item.skipCount,
      topReason: pickTopReason(item.byReason),
      topSubtype: pickTopSubtype(item.bySubtype),
    }))
    .sort((a, b) => b.skipCount - a.skipCount)
    .slice(0, 6);

  return {
    totalImageSkipped: Object.values(byReason).reduce((sum, count) => sum + count, 0),
    byReason,
    bySubtype,
    topAffectedCandidates,
  };
}

export function inferImageFailureHint(summary: ImageSkippedSummary): string {
  if (summary.totalImageSkipped <= 0) {
    return "No image skip diagnostics were recorded for this scope.";
  }
  const topReason = pickTopReason(summary.byReason);
  if (topReason === "full_page_candidate_blocked") {
    return "This job is mainly blocked by full-page candidate safety rules.";
  }
  if (topReason === "operator_mismatch") {
    return "Most image skips come from operator mismatch.";
  }
  if (topReason === "resource_name_mismatch") {
    return "Most image skips come from resource name mismatch.";
  }
  if (
    topReason === "no_instruction_removed" ||
    topReason === "delete_pass_removed_zero_commands" ||
    (summary.bySubtype.delete_pass_removed_zero_commands ?? 0) > 0
  ) {
    return "Most image failures come from zero-command delete passes.";
  }
  if (topReason === "unsafe_candidate_blocked") {
    return "Most image skips are blocked by candidate safety checks.";
  }
  return "Image skip failures are mixed across multiple causes.";
}

export function collectImageSkippedRows(input: {
  processReport: ProcessReportV2 | null;
  candidates: CleanupCandidate[];
  candidateId?: string;
}): ProcessSkipReport[] {
  const candidateKindMap = new Map(input.candidates.map((item) => [item.id, item.kind]));
  const skippedRows = input.processReport?.skippedOperations ?? [];
  return skippedRows.filter((row) => {
    if (!isImageSkipRow(row, candidateKindMap)) {
      return false;
    }
    if (input.candidateId && row.candidateId !== input.candidateId) {
      return false;
    }
    return true;
  });
}

export function getImageCandidateIds(rows: ProcessSkipReport[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.candidateId || seen.has(row.candidateId)) {
      continue;
    }
    seen.add(row.candidateId);
    ids.push(row.candidateId);
  }
  return ids;
}

export function getCandidateIdsByReason(
  rows: ProcessSkipReport[],
  reason: ImageSkipReason,
): string[] {
  const filtered = rows.filter((row) => normalizeImageSkipReason(row) === reason);
  return getImageCandidateIds(filtered);
}

export function getCandidateIdsBySubtype(
  rows: ProcessSkipReport[],
  subtype: string,
): string[] {
  const filtered = rows.filter(
    (row) =>
      normalizeImageSkipSubtype(row, normalizeImageSkipReason(row)) ===
      (subtype as ImageSkipSubtype),
  );
  return getImageCandidateIds(filtered);
}

export function getSelectionPayloadForCandidateIds(
  candidateIds: string[],
): {
  selections: JobSelectionItem[];
} {
  return {
    selections: candidateIds.map((candidateId) => ({
      candidateId,
      applyMode: "all_repeated",
      explicitPages: [],
    })),
  };
}

function isImageSkipRow(
  row: ProcessSkipReport,
  candidateKindMap: Map<string, CleanupCandidate["kind"]>,
): boolean {
  const kind = candidateKindMap.get(row.candidateId);
  if (kind === "image") {
    return true;
  }
  return row.reason === "full_page_candidate_blocked" || row.reason === "unsafe_candidate_blocked";
}

export function normalizeImageSkipReason(row: ProcessSkipReport): ImageSkipReason {
  if (row.reason === "full_page_candidate_blocked") {
    return "full_page_candidate_blocked";
  }
  if (row.reason === "unsafe_candidate_blocked") {
    return "unsafe_candidate_blocked";
  }
  if (row.reason === "operator_mismatch") {
    return "operator_mismatch";
  }
  if (row.reason === "resource_name_mismatch") {
    return "resource_name_mismatch";
  }

  const subtype = String((row.detail?.subtype ?? row.detail?.normalizedSubtype ?? "") || "");
  if (subtype === "delete_pass_removed_zero_commands") {
    return "delete_pass_removed_zero_commands";
  }
  return "no_instruction_removed";
}

export function normalizeImageSkipSubtype(
  row: ProcessSkipReport,
  normalizedReason: ImageSkipReason,
): ImageSkipSubtype {
  const rawSubtype = String((row.detail?.normalizedSubtype ?? row.detail?.subtype ?? "") || "");
  if (
    rawSubtype === "full_page_slide_raster" ||
    rawSubtype === "likely_page_background_image" ||
    rawSubtype === "unsafe_candidate_blocked" ||
    rawSubtype === "operator_mismatch" ||
    rawSubtype === "resource_name_mismatch" ||
    rawSubtype === "delete_pass_removed_zero_commands"
  ) {
    return rawSubtype;
  }
  if (normalizedReason === "full_page_candidate_blocked") {
    return "full_page_slide_raster";
  }
  if (normalizedReason === "unsafe_candidate_blocked") {
    return "unsafe_candidate_blocked";
  }
  if (normalizedReason === "operator_mismatch") {
    return "operator_mismatch";
  }
  if (normalizedReason === "resource_name_mismatch") {
    return "resource_name_mismatch";
  }
  if (normalizedReason === "delete_pass_removed_zero_commands") {
    return "delete_pass_removed_zero_commands";
  }
  return "unknown";
}

function buildEmptyReasonCounter(): Record<ImageSkipReason, number> {
  return {
    full_page_candidate_blocked: 0,
    unsafe_candidate_blocked: 0,
    operator_mismatch: 0,
    resource_name_mismatch: 0,
    no_instruction_removed: 0,
    delete_pass_removed_zero_commands: 0,
  };
}

function pickTopReason(counter: Record<ImageSkipReason, number>): ImageSkipReason {
  return IMAGE_SKIP_REASONS.reduce((best, current) =>
    counter[current] > counter[best] ? current : best,
  "no_instruction_removed");
}

function pickTopSubtype(counter: Record<string, number>): ImageSkipSubtype {
  const entries = Object.entries(counter);
  if (entries.length <= 0) {
    return "unknown";
  }
  const [value] = entries.sort((a, b) => b[1] - a[1])[0] ?? ["unknown", 0];
  return (value as ImageSkipSubtype) || "unknown";
}

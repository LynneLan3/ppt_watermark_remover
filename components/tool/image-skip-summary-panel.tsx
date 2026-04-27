"use client";

import { useMemo, useState } from "react";

import {
  getCandidateIdsByReason,
  getCandidateIdsBySubtype,
  getImageCandidateIds,
  getSelectionPayloadForCandidateIds,
} from "@/lib/jobs/image-skipped-summary";
import type { ImageSkipReason, ImageSkippedSummary, ProcessSkipReport } from "@/lib/jobs/types";

type ImageSkipSummaryPanelProps = {
  title: string;
  summary: ImageSkippedSummary;
  dominantHint: string;
  emptyMessage: string;
  scopeLabel: string;
  skippedRows: ProcessSkipReport[];
};

export function ImageSkipSummaryPanel({
  title,
  summary,
  dominantHint,
  emptyMessage,
  scopeLabel,
  skippedRows,
}: ImageSkipSummaryPanelProps) {
  const [selectedReason, setSelectedReason] = useState<ImageSkipReason>("full_page_candidate_blocked");
  const [selectedSubtype, setSelectedSubtype] = useState("full_page_slide_raster");
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const reasonRows = Object.entries(summary.byReason).sort((a, b) => b[1] - a[1]);
  const subtypeRows = Object.entries(summary.bySubtype).sort((a, b) => b[1] - a[1]);
  const allCandidateIds = useMemo(() => getImageCandidateIds(skippedRows), [skippedRows]);
  const selectedReasonIds = useMemo(
    () => getCandidateIdsByReason(skippedRows, selectedReason),
    [selectedReason, skippedRows],
  );
  const selectedSubtypeIds = useMemo(
    () => getCandidateIdsBySubtype(skippedRows, selectedSubtype),
    [selectedSubtype, skippedRows],
  );

  const copyCandidatesByReason = async (reason: ImageSkipReason) => {
    const ids = getCandidateIdsByReason(skippedRows, reason);
    await copyPlain(ids, `Copied ${ids.length} candidate IDs by reason.`);
  };
  const copyCandidatesBySubtype = async (subtype: string) => {
    const ids = getCandidateIdsBySubtype(skippedRows, subtype);
    await copyPlain(ids, `Copied ${ids.length} candidate IDs by subtype.`);
  };
  const copyAllJsonArray = async () => {
    await copyText(JSON.stringify(allCandidateIds), `Copied JSON array (${allCandidateIds.length}).`);
  };
  const copyAllSelectionPayload = async () => {
    await copyText(
      JSON.stringify(getSelectionPayloadForCandidateIds(allCandidateIds), null, 2),
      "Copied selection payload.",
    );
  };
  const copyBySelectedReason = async () => {
    await copyPlain(
      selectedReasonIds,
      `Copied ${selectedReasonIds.length} candidate IDs for reason ${selectedReason}.`,
    );
  };
  const copyBySelectedSubtype = async () => {
    await copyPlain(
      selectedSubtypeIds,
      `Copied ${selectedSubtypeIds.length} candidate IDs for subtype ${selectedSubtype}.`,
    );
  };
  const copySingleCandidate = async (candidateId: string) => {
    await copyText(candidateId, `Copied ${candidateId}.`);
  };

  async function copyPlain(ids: string[], successMessage: string) {
    await copyText(ids.join("\n"), successMessage, ids.length <= 0);
  }

  async function copyText(value: string, successMessage: string, forceDisabled = false) {
    if (forceDisabled || !value.trim()) {
      setCopyError("No matching candidate IDs to copy.");
      setCopyNotice(null);
      return;
    }
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopyError(null);
      setCopyNotice(successMessage);
      window.setTimeout(() => setCopyNotice(null), 1800);
    } catch (error) {
      setCopyNotice(null);
      setCopyError(error instanceof Error ? error.message : "Copy failed.");
    }
  }

  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
      <h4 className="text-sm font-semibold text-amber-900">{title}</h4>
      <p className="mt-1 text-xs text-amber-800">
        Scope: {scopeLabel} | total image skipped: {summary.totalImageSkipped}
      </p>
      <p className="mt-1 text-xs text-amber-800">{dominantHint}</p>
      {summary.totalImageSkipped <= 0 ? (
        <p className="mt-2 text-xs text-slate-600">{emptyMessage}</p>
      ) : (
        <>
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs font-semibold text-slate-700">Copy tools</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-slate-700">
                Copy candidate IDs by reason
                <div className="mt-1 flex gap-2">
                  <select
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                    value={selectedReason}
                    onChange={(event) => setSelectedReason(event.target.value as ImageSkipReason)}
                  >
                    {reasonRows.map(([reason]) => (
                      <option key={reason} value={reason}>
                        {reason}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={selectedReasonIds.length <= 0}
                    onClick={copyBySelectedReason}
                    className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy IDs
                  </button>
                </div>
              </label>
              <label className="text-xs text-slate-700">
                Copy candidate IDs by subtype
                <div className="mt-1 flex gap-2">
                  <select
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                    value={selectedSubtype}
                    onChange={(event) => setSelectedSubtype(event.target.value)}
                  >
                    {subtypeRows.map(([subtype]) => (
                      <option key={subtype} value={subtype}>
                        {subtype}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={selectedSubtypeIds.length <= 0}
                    onClick={copyBySelectedSubtype}
                    className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy IDs
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={allCandidateIds.length <= 0}
                onClick={copyAllSelectionPayload}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy selection payload
              </button>
              <button
                type="button"
                disabled={allCandidateIds.length <= 0}
                onClick={copyAllJsonArray}
                className="rounded border border-slate-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy JSON array
              </button>
            </div>
            {copyNotice ? <p className="mt-2 text-xs text-emerald-700">{copyNotice}</p> : null}
            {copyError ? <p className="mt-2 text-xs text-rose-700">{copyError}</p> : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-slate-700">By reason</p>
              <ul className="mt-1 space-y-1 text-xs text-slate-700">
                {reasonRows.map(([reason, count]) => (
                  <li key={reason} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1">
                    <span>{reason}</span>
                    <div className="flex items-center gap-2">
                      <span>{count}</span>
                      <button
                        type="button"
                        disabled={getCandidateIdsByReason(skippedRows, reason as ImageSkipReason).length <= 0}
                        onClick={() => copyCandidatesByReason(reason as ImageSkipReason)}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Copy IDs
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">By subtype</p>
              <ul className="mt-1 space-y-1 text-xs text-slate-700">
                {subtypeRows.length > 0 ? (
                  subtypeRows.map(([subtype, count]) => (
                    <li
                      key={subtype}
                      className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1"
                    >
                      <span>{subtype}</span>
                      <div className="flex items-center gap-2">
                        <span>{count}</span>
                        <button
                          type="button"
                          disabled={getCandidateIdsBySubtype(skippedRows, subtype).length <= 0}
                          onClick={() => copyCandidatesBySubtype(subtype)}
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Copy IDs
                        </button>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="rounded border border-slate-200 px-2 py-1 text-slate-500">No subtype rows.</li>
                )}
              </ul>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-700">Top affected candidates</p>
            {summary.topAffectedCandidates.length > 0 ? (
              <div className="mt-1 overflow-x-auto">
                <table className="min-w-full text-xs text-slate-700">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      <th className="px-2 py-1">candidateId</th>
                      <th className="px-2 py-1">skipCount</th>
                      <th className="px-2 py-1">topReason</th>
                      <th className="px-2 py-1">topSubtype</th>
                      <th className="px-2 py-1">tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.topAffectedCandidates.map((item) => (
                      <tr key={item.candidateId} className="border-b border-slate-100">
                        <td className="px-2 py-1">{item.candidateId}</td>
                        <td className="px-2 py-1">{item.skipCount}</td>
                        <td className="px-2 py-1">{item.topReason}</td>
                        <td className="px-2 py-1">{item.topSubtype}</td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => copySingleCandidate(item.candidateId)}
                            className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]"
                          >
                            Copy
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No affected candidates.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

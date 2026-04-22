"use client";

import type { PdfObjectCandidate, PdfObjectType } from "@/lib/local/pdf/types";

type PdfCandidateOverlayProps = {
  candidates: PdfObjectCandidate[];
  activeCandidateId: string | null;
};

const CANDIDATE_STYLES: Record<PdfObjectType, string> = {
  text_run: "border-amber-500 bg-amber-400/10",
  image_xobject: "border-sky-500 bg-sky-400/10",
  form_xobject: "border-violet-500 bg-violet-400/10",
  repeated_overlay: "border-emerald-500 bg-emerald-400/10",
  unsupported_region: "border-rose-500 bg-rose-400/10",
};

export function PdfCandidateOverlay({
  candidates,
  activeCandidateId,
}: PdfCandidateOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {candidates.map((candidate) => {
        const isActive = candidate.id === activeCandidateId;
        const style = CANDIDATE_STYLES[candidate.objectType];

        return (
          <div
            key={candidate.id}
            className={`absolute border ${style} ${
              isActive ? "ring-2 ring-rose-500/80" : ""
            }`}
            style={{
              left: `${candidate.normalizedBoundingBox.x * 100}%`,
              top: `${candidate.normalizedBoundingBox.y * 100}%`,
              width: `${candidate.normalizedBoundingBox.width * 100}%`,
              height: `${candidate.normalizedBoundingBox.height * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}

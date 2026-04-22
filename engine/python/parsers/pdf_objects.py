"""PDF candidate parser and deterministic analysis output (text + image)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
import pikepdf

from grouping.repeat_matcher import (
    PdfCandidate,
    Rect,
    build_repeat_groups,
    make_image_identity_key,
    make_image_repeat_key,
    make_text_repeat_key,
    normalize_text,
)


@dataclass(frozen=True)
class AnalysisResult:
    source_file: str
    total_pages: int
    total_candidates: int
    candidates_by_page: dict[int, list[dict[str, Any]]]
    repeat_groups: list[dict[str, Any]]
    unsupported_pages: list[int]
    notes: list[str]


def analyze_pdf_candidates(input_pdf: Path) -> AnalysisResult:
    total_pages = 0
    with fitz.open(input_pdf) as doc:
        total_pages = doc.page_count
        candidates: list[PdfCandidate] = []

        for page_index in range(doc.page_count):
            page_number = page_index + 1
            page = doc.load_page(page_index)

            text_candidates = extract_text_candidates_from_page(page, page_number)
            image_candidates = extract_image_candidates_from_page(page, page_number)

            page_candidates = sorted(
                [*text_candidates, *image_candidates],
                key=lambda c: (
                    c.object_type,
                    c.bbox.y,
                    c.bbox.x,
                    c.identity_key,
                    c.normalized_text,
                    c.text,
                ),
            )

            # Deterministic IDs after sorting.
            text_index = 0
            image_index = 0
            normalized_candidates: list[PdfCandidate] = []
            for candidate in page_candidates:
                if candidate.object_type == "text_run":
                    normalized_candidates.append(
                        replace(candidate, id=f"text-run-{page_number}-{text_index}")
                    )
                    text_index += 1
                else:
                    normalized_candidates.append(
                        replace(candidate, id=f"image-xobject-{page_number}-{image_index}")
                    )
                    image_index += 1

            candidates.extend(normalized_candidates)

    repeat_groups_raw = build_repeat_groups(candidates)
    repeat_groups = [_repeat_group_to_wire(group) for group in repeat_groups_raw]
    repeat_map = {group["repeatKey"]: group for group in repeat_groups}

    candidates_by_page: dict[int, list[dict[str, Any]]] = {}
    unsupported_pages: list[int] = []
    for page_number in range(1, total_pages + 1):
        page_candidates = [c for c in candidates if c.page_number == page_number]
        wire = [_candidate_to_wire(candidate, repeat_map) for candidate in page_candidates]
        candidates_by_page[page_number] = wire
        if not wire or all(candidate.get("removability") != "supported" for candidate in wire):
            unsupported_pages.append(page_number)

    # Structural readability check.
    with pikepdf.open(input_pdf):
        pass

    notes = [
        "Engine analysis supports text_run and narrow image_xobject candidates.",
        "form_xobject and flattened/background restoration are deferred.",
        "Candidate and group ordering are deterministic for reproducible fixtures.",
        "Timestamps are intentionally omitted from analysis JSON for stable artifacts.",
        "Unsupported groups include explicit reasonCode hints for safer fail-safe handling.",
    ]

    return AnalysisResult(
        source_file=str(input_pdf),
        total_pages=total_pages,
        total_candidates=len(candidates),
        candidates_by_page=candidates_by_page,
        repeat_groups=repeat_groups,
        unsupported_pages=sorted(unsupported_pages),
        notes=notes,
    )


def analyze_pdf_text_candidates(input_pdf: Path) -> AnalysisResult:
    """Backward-compatible alias used by existing tests/callers."""
    return analyze_pdf_candidates(input_pdf)


def extract_text_candidates_from_page(page: fitz.Page, page_number: int) -> list[PdfCandidate]:
    data = page.get_text("dict")
    page_rect = page.rect
    page_width = max(page_rect.width, 1.0)
    page_height = max(page_rect.height, 1.0)

    out: list[PdfCandidate] = []

    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue

        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = str(span.get("text", "")).strip()
                if not text:
                    continue

                x0, y0, x1, y1 = span.get("bbox", (0.0, 0.0, 0.0, 0.0))
                bbox = _normalize_rect(
                    x0=x0,
                    y0=y0,
                    x1=x1,
                    y1=y1,
                    page_width=page_width,
                    page_height=page_height,
                )
                if bbox.width <= 0.001 or bbox.height <= 0.001:
                    continue

                area = bbox.width * bbox.height
                near_top_or_bottom = bbox.y < 0.2 or (bbox.y + bbox.height) > 0.8
                small = area < 0.06
                text_len_bonus = min(0.15, len(text) * 0.005)
                confidence = min(
                    0.95,
                    0.4
                    + (0.18 if near_top_or_bottom else 0.0)
                    + (0.1 if small else 0.0)
                    + text_len_bonus,
                )

                normalized = normalize_text(text)
                repeat_key = make_text_repeat_key(normalized, bbox)
                reasons = [
                    "Detected as independent text in PDF text layer.",
                    "Near header/footer zone." if near_top_or_bottom else "Located in body zone.",
                ]

                out.append(
                    PdfCandidate(
                        id="temp",
                        page_number=page_number,
                        object_type="text_run",
                        text=text,
                        label=text[:80],
                        normalized_text=normalized,
                        bbox=bbox,
                        confidence=confidence,
                        repeat_key=repeat_key,
                        identity_key=f"text:{normalized}",
                        reasons=tuple(reasons),
                    )
                )

    return out


def extract_image_candidates_from_page(page: fitz.Page, page_number: int) -> list[PdfCandidate]:
    info_list = page.get_image_info(xrefs=True)
    page_rect = page.rect
    page_width = max(page_rect.width, 1.0)
    page_height = max(page_rect.height, 1.0)

    out: list[PdfCandidate] = []

    for info in info_list:
        bbox_values = info.get("bbox")
        if not bbox_values or len(bbox_values) != 4:
            continue

        bbox = _normalize_rect(
            x0=float(bbox_values[0]),
            y0=float(bbox_values[1]),
            x1=float(bbox_values[2]),
            y1=float(bbox_values[3]),
            page_width=page_width,
            page_height=page_height,
        )
        area = bbox.width * bbox.height
        if area <= 0:
            continue

        xref = int(info.get("xref", 0))
        width_px = int(info.get("width", 0))
        height_px = int(info.get("height", 0))
        colorspace = str(info.get("cs-name", "unknown"))

        identity_key = make_image_identity_key(
            xref=xref,
            width_px=width_px,
            height_px=height_px,
            colorspace=colorspace,
        )
        repeat_key = make_image_repeat_key(identity_key, bbox)

        near_corner = (
            bbox.x < 0.2
            or bbox.x + bbox.width > 0.8
            or bbox.y < 0.2
            or bbox.y + bbox.height > 0.8
        )
        very_small = area < 0.08
        confidence = 0.38
        if area < 0.12:
            confidence += 0.2
        if near_corner:
            confidence += 0.15
        if near_corner and very_small:
            confidence += 0.08
        if area > 0.35:
            confidence -= 0.25
        confidence = max(0.1, min(0.95, confidence))

        reasons = ["Detected as independent image XObject invocation on page."]
        if area > 0.35:
            reasons.append("Image area is large; may be background/content rather than removable overlay.")
        else:
            reasons.append("Image area is small enough to be considered overlay/logo candidate.")

        out.append(
            PdfCandidate(
                id="temp",
                page_number=page_number,
                object_type="image_xobject",
                text="",
                label=f"Image XObject xref={xref}",
                normalized_text="",
                bbox=bbox,
                confidence=confidence,
                repeat_key=repeat_key,
                identity_key=identity_key,
                reasons=tuple(reasons),
            )
        )

    return out


def _normalize_rect(
    *,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    page_width: float,
    page_height: float,
) -> Rect:
    x = max(0.0, min(1.0, x0 / page_width))
    y = max(0.0, min(1.0, y0 / page_height))
    width = max(0.0, min(1.0 - x, (x1 - x0) / page_width))
    height = max(0.0, min(1.0 - y, (y1 - y0) / page_height))
    return Rect(x=x, y=y, width=width, height=height)


def _candidate_to_wire(
    candidate: PdfCandidate,
    repeat_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    group = repeat_map.get(candidate.repeat_key)
    repeat_count = int(group["repeatCount"]) if group else 1
    removability = group["removability"] if group else "unsupported"
    group_reason_code = group.get("reasonCode") if group else "unsupported_structure"
    placement_hint = group.get("placementHint") if group else "unknown"
    group_reasons = list(group.get("reasons", [])) if group else []
    reasons = list(candidate.reasons) + [
        reason for reason in group_reasons if reason not in candidate.reasons
    ]

    payload: dict[str, Any] = {
        "id": candidate.id,
        "pageNumber": candidate.page_number,
        "objectType": candidate.object_type,
        "text": candidate.text,
        "label": candidate.label,
        "normalizedText": candidate.normalized_text,
        "boundingBox": {
            "x": candidate.bbox.x,
            "y": candidate.bbox.y,
            "width": candidate.bbox.width,
            "height": candidate.bbox.height,
        },
        "normalizedBoundingBox": {
            "x": candidate.bbox.x,
            "y": candidate.bbox.y,
            "width": candidate.bbox.width,
            "height": candidate.bbox.height,
        },
        "repeatKey": candidate.repeat_key,
        "repeatCount": repeat_count,
        "confidence": round(candidate.confidence, 6),
        "removability": removability,
        "reasons": reasons,
        "reasonCode": group_reason_code,
        "placementHint": placement_hint,
        "identityKey": candidate.identity_key,
    }
    if removability == "unsupported":
        payload["unsupportedReasonCode"] = group_reason_code

    if candidate.object_type == "image_xobject":
        payload["imageIdentityKey"] = candidate.identity_key
        payload["resourceName"] = candidate.identity_key

    return payload


def _repeat_group_to_wire(group: Any) -> dict[str, Any]:
    return {
        "repeatKey": group.repeat_key,
        "objectType": group.object_type,
        "identityKey": group.identity_key,
        "normalizedText": group.normalized_text,
        "pages": list(group.pages),
        "candidateIds": list(group.candidate_ids),
        "repeatCount": group.repeat_count,
        "confidence": round(group.confidence, 6),
        "removability": group.removability,
        "reasonCode": group.reason_code,
        "placementHint": group.placement_hint,
        "reasons": list(group.reasons),
    }


def analysis_result_to_dict(result: AnalysisResult) -> dict[str, Any]:
    ordered_candidates: dict[str, list[dict[str, Any]]] = {
        str(page): result.candidates_by_page[page] for page in sorted(result.candidates_by_page)
    }

    return {
        "sourceFile": result.source_file,
        "totalPages": result.total_pages,
        "totalCandidates": result.total_candidates,
        "candidatesByPage": ordered_candidates,
        "repeatGroups": result.repeat_groups,
        "unsupportedPages": result.unsupported_pages,
        "notes": result.notes,
    }

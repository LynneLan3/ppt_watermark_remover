"""Apply validated text_run / image_xobject removal plans with fail-safe checks."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
import pikepdf

from models.plan import RemovalPlan, ensure_plan_supported_for_apply, ensure_plan_supported_for_text_removal
from parsers.pdf_objects import AnalysisResult, analyze_pdf_candidates


class RemovalError(RuntimeError):
    """Raised when apply-plan should fail safely."""


@dataclass(frozen=True)
class RemovalOutcome:
    success: bool
    input_file: str
    output_file: str
    selected_candidate_id: str
    object_type: str
    scope_mode: str
    target_pages: list[int]
    matched_objects_count: int
    removed_objects_count: int
    affected_pages: list[int]
    warnings: list[str]
    unsupported_flags: list[str]
    failure_reason: str | None
    before_text_objects_by_page: dict[int, int]
    after_text_objects_by_page: dict[int, int]
    before_image_objects_by_page: dict[int, int]
    after_image_objects_by_page: dict[int, int]


def apply_removal_plan(
    input_pdf: Path,
    output_pdf: Path,
    plan: RemovalPlan,
) -> RemovalOutcome:
    object_type = ensure_plan_supported_for_apply(plan)

    analysis: AnalysisResult = analyze_pdf_candidates(input_pdf)

    repeat_group = _find_repeat_group(analysis, plan.selected_candidate.repeat_key)
    if repeat_group is None:
        raise RemovalError(
            "Could not find matching repeat group for selectedCandidate.repeatKey in input PDF."
        )

    if repeat_group.get("objectType") != object_type:
        raise RemovalError(
            "Repeat-key group object type does not match selected candidate type."
        )

    if repeat_group["removability"] != "supported":
        raise RemovalError(
            "Matched repeat group is not marked supported; refusing to apply removal."
        )

    target_pages = sorted(set(plan.scope.target_pages))
    page_to_candidates = _find_candidates_for_repeat_key(
        analysis=analysis,
        repeat_key=plan.selected_candidate.repeat_key,
        object_type=object_type,
        target_pages=target_pages,
    )
    matched_count = sum(len(items) for items in page_to_candidates.values())
    if matched_count == 0:
        raise RemovalError("No safe candidates matched on target pages.")

    warnings: list[str] = []
    unsupported_flags: list[str] = []
    for page in target_pages:
        if page not in page_to_candidates:
            message = f"No matching {object_type} candidate found on target page {page}; page skipped."
            warnings.append(message)
            unsupported_flags.append(f"missing_match_page_{page}")

    # Additional image-specific hard fail check.
    if object_type == "image_xobject":
        for candidates in page_to_candidates.values():
            for candidate in candidates:
                area = (
                    float(candidate["normalizedBoundingBox"]["width"])
                    * float(candidate["normalizedBoundingBox"]["height"])
                )
                if area >= 0.35:
                    raise RemovalError(
                        "Matched image candidate is too large (likely background/core content)."
                    )

    with pikepdf.open(input_pdf):
        pass

    before_text_counts: dict[int, int] = {}
    after_text_counts: dict[int, int] = {}
    before_image_counts: dict[int, int] = {}
    after_image_counts: dict[int, int] = {}
    removed_count = 0
    affected_pages: list[int] = []

    with fitz.open(input_pdf) as doc:
        for page_num, candidates in sorted(page_to_candidates.items()):
            page = doc.load_page(page_num - 1)
            before_text_counts[page_num] = _count_text_objects(page)
            before_image_counts[page_num] = _count_image_objects(page)

            for candidate in candidates:
                rect = _denormalize_bbox(page.rect, candidate["normalizedBoundingBox"])
                page.add_redact_annot(rect, text="", fill=(1, 1, 1))
                removed_count += 1

            if object_type == "text_run":
                page.apply_redactions(
                    images=fitz.PDF_REDACT_IMAGE_NONE,
                    graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                    text=fitz.PDF_REDACT_TEXT_REMOVE,
                )
            else:
                page.apply_redactions(
                    images=fitz.PDF_REDACT_IMAGE_REMOVE,
                    graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                    text=fitz.PDF_REDACT_TEXT_NONE,
                )

            after_text_counts[page_num] = _count_text_objects(page)
            after_image_counts[page_num] = _count_image_objects(page)
            affected_pages.append(page_num)

        doc.save(output_pdf)

    with pikepdf.open(output_pdf):
        pass

    return RemovalOutcome(
        success=True,
        input_file=str(input_pdf),
        output_file=str(output_pdf),
        selected_candidate_id=plan.selected_candidate.id,
        object_type=plan.selected_candidate.object_type,
        scope_mode=plan.scope.mode,
        target_pages=target_pages,
        matched_objects_count=matched_count,
        removed_objects_count=removed_count,
        affected_pages=affected_pages,
        warnings=warnings,
        unsupported_flags=unsupported_flags,
        failure_reason=None,
        before_text_objects_by_page=before_text_counts,
        after_text_objects_by_page=after_text_counts,
        before_image_objects_by_page=before_image_counts,
        after_image_objects_by_page=after_image_counts,
    )


def apply_text_removal_plan(
    input_pdf: Path,
    output_pdf: Path,
    plan: RemovalPlan,
) -> RemovalOutcome:
    ensure_plan_supported_for_text_removal(plan)
    return apply_removal_plan(input_pdf, output_pdf, plan)


def _find_repeat_group(analysis: AnalysisResult, repeat_key: str) -> dict[str, Any] | None:
    for group in analysis.repeat_groups:
        if group.get("repeatKey") == repeat_key:
            return group
    return None


def _find_candidates_for_repeat_key(
    *,
    analysis: AnalysisResult,
    repeat_key: str,
    object_type: str,
    target_pages: list[int],
) -> dict[int, list[dict[str, Any]]]:
    out: dict[int, list[dict[str, Any]]] = {}
    for page in target_pages:
        page_candidates = analysis.candidates_by_page.get(page, [])
        if not page_candidates:
            page_candidates = analysis.candidates_by_page.get(str(page), [])

        min_conf = 0.55 if object_type == "text_run" else 0.6
        matching = [
            candidate
            for candidate in page_candidates
            if candidate.get("objectType") == object_type
            and candidate.get("repeatKey") == repeat_key
            and float(candidate.get("confidence", 0)) >= min_conf
            and candidate.get("removability") == "supported"
        ]
        if matching:
            out[page] = matching
    return out


def _denormalize_bbox(page_rect: fitz.Rect, bbox: dict[str, float]) -> fitz.Rect:
    x = max(0.0, min(1.0, float(bbox.get("x", 0.0))))
    y = max(0.0, min(1.0, float(bbox.get("y", 0.0))))
    width = max(0.0, min(1.0 - x, float(bbox.get("width", 0.0))))
    height = max(0.0, min(1.0 - y, float(bbox.get("height", 0.0))))

    return fitz.Rect(
        page_rect.x0 + x * page_rect.width,
        page_rect.y0 + y * page_rect.height,
        page_rect.x0 + (x + width) * page_rect.width,
        page_rect.y0 + (y + height) * page_rect.height,
    )


def _count_text_objects(page: fitz.Page) -> int:
    data = page.get_text("dict")
    count = 0
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            count += len(line.get("spans", []))
    return count


def _count_image_objects(page: fitz.Page) -> int:
    return len(page.get_image_info(xrefs=True))

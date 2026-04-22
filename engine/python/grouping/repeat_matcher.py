"""Deterministic repeat-key grouping for text and image candidates."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class Rect:
    x: float
    y: float
    width: float
    height: float


@dataclass(frozen=True)
class PdfCandidate:
    id: str
    page_number: int
    object_type: str
    text: str
    label: str
    normalized_text: str
    bbox: Rect
    confidence: float
    repeat_key: str
    identity_key: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class RepeatGroup:
    repeat_key: str
    object_type: str
    identity_key: str
    normalized_text: str
    pages: tuple[int, ...]
    candidate_ids: tuple[str, ...]
    repeat_count: int
    confidence: float
    removability: str
    reason_code: str
    placement_hint: str
    reasons: tuple[str, ...]


def normalize_text(text: str) -> str:
    return " ".join(text.strip().lower().split())


def quantize(value: float, steps: int = 20) -> float:
    return round(value * steps) / steps


def make_text_repeat_key(normalized_text: str, bbox: Rect) -> str:
    return ":".join(
        [
            "text_run",
            normalized_text,
            f"{quantize(bbox.x):.2f}",
            f"{quantize(bbox.y):.2f}",
            f"{quantize(bbox.width):.2f}",
            f"{quantize(bbox.height):.2f}",
        ]
    )


def make_image_identity_key(*, xref: int, width_px: int, height_px: int, colorspace: str) -> str:
    return f"img:{xref}:{width_px}x{height_px}:{colorspace}"


def make_image_repeat_key(identity_key: str, bbox: Rect) -> str:
    return ":".join(
        [
            "image_xobject",
            identity_key,
            f"{quantize(bbox.x):.2f}",
            f"{quantize(bbox.y):.2f}",
            f"{quantize(bbox.width):.2f}",
            f"{quantize(bbox.height):.2f}",
        ]
    )


def build_repeat_groups(candidates: Iterable[PdfCandidate]) -> list[RepeatGroup]:
    buckets: dict[str, list[PdfCandidate]] = defaultdict(list)
    for candidate in candidates:
        buckets[candidate.repeat_key].append(candidate)

    groups: list[RepeatGroup] = []
    for repeat_key, bucket in buckets.items():
        sorted_bucket = sorted(
            bucket,
            key=lambda item: (
                item.page_number,
                item.bbox.y,
                item.bbox.x,
                item.identity_key,
                item.id,
            ),
        )

        pages = sorted({item.page_number for item in sorted_bucket})
        repeat_count = len(pages)

        base_conf = sum(item.confidence for item in sorted_bucket) / max(len(sorted_bucket), 1)
        repeat_bonus = min(0.2, max(0, repeat_count - 1) * 0.05)
        confidence = min(0.95, base_conf + repeat_bonus)

        removability, reason_code, placement_hint, reasoning = classify_removability(
            object_type=sorted_bucket[0].object_type,
            confidence=confidence,
            repeat_count=repeat_count,
            candidates=sorted_bucket,
        )

        reasons = [
            f"Detected on {repeat_count} page(s) with the same repeat key.",
            f"Average confidence after repeat bonus: {confidence:.2f}.",
            reasoning,
        ]

        groups.append(
            RepeatGroup(
                repeat_key=repeat_key,
                object_type=sorted_bucket[0].object_type,
                identity_key=sorted_bucket[0].identity_key,
                normalized_text=sorted_bucket[0].normalized_text,
                pages=tuple(pages),
                candidate_ids=tuple(item.id for item in sorted_bucket),
                repeat_count=repeat_count,
                confidence=confidence,
                removability=removability,
                reason_code=reason_code,
                placement_hint=placement_hint,
                reasons=tuple(reasons),
            )
        )

    groups.sort(
        key=lambda g: (
            g.removability != "supported",
            g.object_type,
            -g.repeat_count,
            -g.confidence,
            g.repeat_key,
        )
    )
    return groups


def classify_removability(
    *,
    object_type: str,
    confidence: float,
    repeat_count: int,
    candidates: list[PdfCandidate],
) -> tuple[str, str, str, str]:
    if object_type == "text_run":
        placement_hint = _classify_text_placement(candidates)
        avg_area = sum(candidate.bbox.width * candidate.bbox.height for candidate in candidates) / max(
            len(candidates),
            1,
        )
        edge_like = placement_hint in {"header", "footer"}
        high_repeat = repeat_count >= 3

        if repeat_count >= 2 and confidence >= 0.62:
            if edge_like and avg_area <= 0.08:
                if placement_hint in {"header", "footer"}:
                    reason_code = f"repeated_{placement_hint}_text_supported"
                return (
                    "supported",
                    reason_code,
                    placement_hint,
                    "Strong repeated independent text signal; safe candidate for engine apply-plan.",
                )
            if edge_like and high_repeat and avg_area <= 0.1 and confidence >= 0.6:
                return (
                    "supported",
                    f"repeated_{placement_hint}_text_supported",
                    placement_hint,
                    "Edge text repeats across many pages with stable signal; acceptable for safe apply-plan.",
                )
            return (
                "review_required",
                "repeated_text_review_required",
                placement_hint,
                "Repeated text appears away from branding zones or too large; manual review required.",
            )
        if repeat_count >= 2 and confidence >= 0.5:
            if not edge_like:
                return (
                    "unsupported",
                    "unsupported_structure",
                    placement_hint,
                    "Repeated body text is likely document content instead of removable branding.",
                )
            return (
                "review_required",
                "repeated_text_review_required",
                placement_hint,
                "Partial repeat signal; requires manual review before deletion.",
            )
        return (
            "unsupported",
            "unsupported_structure",
            placement_hint,
            "Weak or non-repeating signal; fail-safe path should reject removal.",
        )

    if object_type == "image_xobject":
        areas = [candidate.bbox.width * candidate.bbox.height for candidate in candidates]
        max_area = max(areas)
        avg_area = sum(areas) / max(len(areas), 1)
        center_x = [candidate.bbox.x + candidate.bbox.width / 2 for candidate in candidates]
        center_y = [candidate.bbox.y + candidate.bbox.height / 2 for candidate in candidates]
        pos_spread = (max(center_x) - min(center_x)) + (max(center_y) - min(center_y))
        placement_hint = _classify_image_placement(candidates)

        if max_area >= 0.35:
            return (
                "unsupported",
                "large_background_image",
                "background",
                "Image candidate is too large and likely part of page background/content.",
            )

        if repeat_count < 2:
            return (
                "unsupported",
                "non_repeated_decorative_image",
                placement_hint,
                "Image appears only once; repeated independent overlay signal is insufficient.",
            )

        if avg_area < 0.12 and pos_spread <= 0.08 and confidence >= 0.6:
            reason_code = (
                "repeated_corner_logo_supported"
                if placement_hint == "corner"
                else "repeated_image_xobject_supported"
            )
            return (
                "supported",
                reason_code,
                placement_hint,
                "Small repeated image with stable position; likely independent overlay/logo XObject.",
            )

        if (
            placement_hint == "corner"
            and repeat_count >= 2
            and avg_area < 0.09
            and pos_spread <= 0.12
            and confidence >= 0.52
        ):
            return (
                "supported",
                "repeated_corner_logo_supported",
                placement_hint,
                "Corner logo repeats with compact area and acceptable stability; safe removal is likely.",
            )

        if avg_area < 0.18 and pos_spread <= 0.12 and confidence >= 0.5:
            return (
                "review_required",
                "repeated_image_xobject_review_required",
                placement_hint,
                "Image is somewhat repeatable but not strong enough for default-safe deletion.",
            )

        if pos_spread > 0.18:
            return (
                "unsupported",
                "likely_background_baked",
                placement_hint,
                "Image repeats with unstable placement and likely belongs to baked/flattened content.",
            )

        return (
            "unsupported",
            "unsupported_structure",
            placement_hint,
            "Image repeat/size/position signals are ambiguous; refusing removal.",
        )

    return (
        "unsupported",
        "unsupported_structure",
        "unknown",
        "Unknown object type for repeat classification.",
    )


def _classify_text_placement(candidates: list[PdfCandidate]) -> str:
    centers_y = [candidate.bbox.y + candidate.bbox.height / 2 for candidate in candidates]
    avg_center_y = sum(centers_y) / max(len(centers_y), 1)
    if avg_center_y <= 0.14:
        return "header"
    if avg_center_y >= 0.86:
        return "footer"
    return "body"


def _classify_image_placement(candidates: list[PdfCandidate]) -> str:
    centers_x = [candidate.bbox.x + candidate.bbox.width / 2 for candidate in candidates]
    centers_y = [candidate.bbox.y + candidate.bbox.height / 2 for candidate in candidates]
    avg_center_x = sum(centers_x) / max(len(centers_x), 1)
    avg_center_y = sum(centers_y) / max(len(centers_y), 1)
    avg_area = sum(candidate.bbox.width * candidate.bbox.height for candidate in candidates) / max(
        len(candidates),
        1,
    )

    if avg_area >= 0.35:
        return "background"
    if avg_center_y <= 0.2:
        if avg_center_x <= 0.25 or avg_center_x >= 0.75:
            return "corner"
        return "header"
    if avg_center_y >= 0.8:
        if avg_center_x <= 0.25 or avg_center_x >= 0.75:
            return "corner"
        return "footer"
    if avg_center_x <= 0.18 or avg_center_x >= 0.82:
        return "side"
    return "body"

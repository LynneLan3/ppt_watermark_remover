#!/usr/bin/env python3
"""PDF fingerprint helpers for exporter/template/structure buckets."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import pikepdf


def build_exporter_fingerprint(pdf: pikepdf.Pdf) -> dict[str, Any]:
    producer = safe_string(getattr(pdf.docinfo, "Producer", "") or pdf.docinfo.get("/Producer", ""))
    creator = safe_string(getattr(pdf.docinfo, "Creator", "") or pdf.docinfo.get("/Creator", ""))
    normalized_producer = normalize_family(producer)
    normalized_creator = normalize_family(creator)
    object_streams_enabled = has_object_streams(pdf)
    compressed_contents = has_compressed_contents(pdf)
    exporter_bucket_id = (
        f"{normalized_producer}__{normalized_creator}"
        f"__objstm:{'on' if object_streams_enabled else 'off'}"
        f"__cmp:{'on' if compressed_contents else 'off'}"
    )
    return {
        "rawProducer": producer or "unknown",
        "rawCreator": creator or "unknown",
        "normalizedProducerFamily": normalized_producer,
        "normalizedCreatorFamily": normalized_creator,
        "exporterBucketId": exporter_bucket_id,
        "objectStreamsEnabled": object_streams_enabled,
        "compressedContentStreams": compressed_contents,
    }


def build_template_page_signatures(
    *,
    page_commands: list[dict[str, Any]],
    page_count: int,
) -> dict[int, dict[str, Any]]:
    grouped: dict[int, list[dict[str, Any]]] = {page: [] for page in range(1, page_count + 1)}
    for command in page_commands:
        page = int(command.get("page", 0))
        if page > 0:
            grouped.setdefault(page, []).append(command)

    signatures: dict[int, dict[str, Any]] = {}
    for page in range(1, page_count + 1):
        commands = sorted(grouped.get(page, []), key=lambda row: int(row.get("commandIndex", 0)))
        vector_count = sum(1 for row in commands if row.get("operatorType") == "vector_paint")
        text_count = sum(1 for row in commands if row.get("operatorType") == "text_show")
        xobject_count = sum(1 for row in commands if row.get("operatorType") == "xobject_do")
        total = max(1, len(commands))
        footer_vector = sum(
            1 for row in commands if row.get("operatorType") == "vector_paint" and bbox_bottom(row) < 0.2
        )
        header_vector = sum(
            1 for row in commands if row.get("operatorType") == "vector_paint" and bbox_top(row) > 0.8
        )
        depth_values = [int(row.get("graphicsDepth", 0)) for row in commands]
        depth_band = "deep" if any(value >= 3 for value in depth_values) else "normal"
        mix_ratio = (
            f"v:{round(vector_count/total,3)}|t:{round(text_count/total,3)}|x:{round(xobject_count/total,3)}"
        )
        operator_hist = Counter(str(row.get("operatorName", "")) for row in commands if row.get("operatorName"))
        top_ops = ",".join([name for name, _ in operator_hist.most_common(4)])
        signature = (
            f"mix:{mix_ratio}|footer:{footer_vector}|header:{header_vector}|depth:{depth_band}|ops:{top_ops}"
        )
        signatures[page] = {
            "templatePageSignature": signature,
            "vectorTextXobjectMixRatio": {
                "vector": round(vector_count / total, 4),
                "text": round(text_count / total, 4),
                "xobject": round(xobject_count / total, 4),
            },
            "graphicsDepthBand": depth_band,
            "footerVectorCount": footer_vector,
            "headerVectorCount": header_vector,
        }
    return signatures


def build_structure_tags(
    *,
    exporter_fingerprint: dict[str, Any],
    page_profile: dict[str, Any],
) -> list[str]:
    tags: list[str] = []
    if exporter_fingerprint.get("objectStreamsEnabled"):
        tags.append("objectStreamsEnabled")
    if exporter_fingerprint.get("compressedContentStreams"):
        tags.append("compressedContentStreams")

    mix = page_profile.get("vectorTextXobjectMixRatio", {})
    vector_ratio = float(mix.get("vector", 0))
    text_ratio = float(mix.get("text", 0))

    if vector_ratio >= 0.45:
        tags.append("vectorHeavyPage")
    if page_profile.get("footerVectorCount", 0) >= 2:
        tags.append("repeatedFooterRegionBlocks")
    if page_profile.get("graphicsDepthBand") == "deep":
        tags.append("deepGraphicsStack")
    if vector_ratio >= 0.2 and text_ratio >= 0.2:
        tags.append("textVectorMixedRegion")
    if vector_ratio >= 0.65 and text_ratio < 0.15:
        tags.append("highBlockSignatureVariance")

    return sorted(set(tags))


def has_object_streams(pdf: pikepdf.Pdf) -> bool:
    try:
        for obj in pdf.objects:
            if isinstance(obj, pikepdf.Stream):
                if safe_string(obj.get("/Type", "")) == "/ObjStm":
                    return True
    except Exception:  # pylint: disable=broad-except
        return False
    return False


def has_compressed_contents(pdf: pikepdf.Pdf) -> bool:
    try:
        for page in pdf.pages:
            contents = page.obj.get("/Contents", None)
            if contents is None:
                continue
            if isinstance(contents, pikepdf.Stream):
                if contents.get("/Filter", None) is not None:
                    return True
            if isinstance(contents, pikepdf.Array):
                for item in contents:
                    if isinstance(item, pikepdf.Stream) and item.get("/Filter", None) is not None:
                        return True
    except Exception:  # pylint: disable=broad-except
        return False
    return False


def normalize_family(text: str) -> str:
    low = text.lower()
    if not low:
        return "unknown"
    rules = [
        ("notebooklm", "notebooklm_like"),
        ("canva", "canva_like"),
        ("adobe", "adobe_like"),
        ("wkhtmltopdf", "wkhtmltopdf_like"),
        ("ghostscript", "ghostscript_like"),
        ("google", "google_like"),
        ("microsoft", "microsoft_like"),
        ("libreoffice", "libreoffice_like"),
    ]
    for needle, family in rules:
        if needle in low:
            return family
    compact = re.sub(r"[^a-z0-9]+", "_", low).strip("_")
    return compact[:40] if compact else "custom"


def bbox_bottom(command: dict[str, Any]) -> float:
    bbox = command.get("bbox", {})
    return float(bbox.get("y", 0))


def bbox_top(command: dict[str, Any]) -> float:
    bbox = command.get("bbox", {})
    return float(bbox.get("y", 0)) + float(bbox.get("height", 0))


def safe_string(value: Any) -> str:
    try:
        return str(value).strip()
    except Exception:  # pylint: disable=broad-except
        return ""

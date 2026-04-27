#!/usr/bin/env python3
"""Raster-page watermark cleanup MVP for NotebookLM exports."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz

try:
    import cv2  # type: ignore
    import numpy as np  # type: ignore

    HAS_OPENCV = True
except Exception:  # pylint: disable=broad-except
    HAS_OPENCV = False
    cv2 = None
    np = None


@dataclass
class Box:
    x: int
    y: int
    width: int
    height: int


@dataclass
class TemplateLock:
    template_id: str
    width: int
    height: int
    margin_right: int
    margin_bottom: int
    score: float


SEARCH_X_MIN = 0.90
SEARCH_X_MAX = 0.998
SEARCH_Y_MIN = 0.95
SEARCH_Y_MAX = 0.998
MAX_BOX_WIDTH_RATIO = 0.085
MAX_BOX_HEIGHT_RATIO = 0.04
MAX_BOX_AREA_RATIO = 0.0032
TARGET_BOX_WIDTH_RATIO = 0.064
TARGET_BOX_HEIGHT_RATIO = 0.028
MAX_REPAIR_AREA_RATIO = 0.0055
ANCHOR_X_RATIO = 0.955
ANCHOR_Y_RATIO = 0.974
ANCHOR_MAX_DX_RATIO = 0.055
ANCHOR_MAX_DY_RATIO = 0.034
MASK_DILATION_PX = 2
MIN_MASK_HEIGHT_RATIO = 0.65
MAX_MASK_HEIGHT_RATIO = 0.9
MIN_FINAL_MASK_RATIO = 0.85
SECOND_PASS_EXPAND_LEFT = 6
SECOND_PASS_EXPAND_TOP = 10
SECOND_PASS_EXPAND_WIDTH = 10
SECOND_PASS_EXPAND_HEIGHT = 14
RESIDUAL_PASS_RATIO = 0.42
RESIDUAL_PASS_ABSOLUTE = 0.025
CORNER_TEMPLATE_RESIDUAL_PASS = 0.018
TEMPLATE_SIMILARITY_PASS_RATIO = 0.62
TEXT_RESIDUAL_PASS = 0.14
DAMAGE_LUMA_PASS = 0.18
DAMAGE_TEXTURE_PASS = 0.9
DAMAGE_SEAM_PASS = 0.16
LIGHT_GRADIENT_BRIGHTNESS_JITTER = 0.09
LIGHT_COMPLEX_RESIDUAL_PASS = 0.24
LIGHT_COMPLEX_DAMAGE_TEXTURE_PASS = 1.2
LIGHT_COMPLEX_SEAM_PASS = 0.09
LIGHT_COMPLEX_BRIGHTNESS_PASS = 0.08
LIGHT_COMPLEX_STRUCTURE_BREAK_PASS = 0.45
LIGHT_COMPLEX_TRAILING_RESIDUAL_TRIGGER = 0.2
LIGHT_COMPLEX_TEXTURE_SURGE_ABORT_DELTA = 0.35
LIGHT_COMPLEX_RERANK_RESIDUAL_EPSILON = 0.026
LIGHT_COMPLEX_SEAM_HARD_CAP = 0.072
LIGHT_COMPLEX_BRIGHTNESS_HARD_CAP = 0.062
TRAILING_BRIGHTNESS_MATCH_TRIGGER = 0.99
SEAM_RING_RESIDUAL_EPSILON = 0.005
SEAM_RING_TEXTURE_EPSILON = 0.02
SEAM_RING_BRIGHTNESS_EPSILON = 0.002
SEAM_MICRO_STRENGTH = 0.044
SEAM_MICRO_RESIDUAL_MAX_DELTA = 0.002
SEAM_MICRO_TEXTURE_MAX_DELTA = 0.01
SEAM_MICRO_BRIGHTNESS_MAX_DELTA = 0.001
SEAM_MICRO_MIN_SEAM_DROP_PASSED = 0.0004
SEAM_MICRO_SEAM_ALREADY_LOW = 0.04
SEAM_MICRO_TARGET_SEAM = 0.05
SEAM_MICRO_DENSE_SIGNIFICANT_DROP = 0.012
GLYPH_DILATION_RADIUS = 2
GLYPH_MARGIN_X = 4
GLYPH_MARGIN_TOP = 3
GLYPH_MARGIN_BOTTOM = 5
TEMPLATE_SPECS = {
    "template_compact": {"width": 220, "height": 53, "maxMaskHeight": 18},
    "template_wide": {"width": 268, "height": 69, "maxMaskHeight": 24},
}
MAX_X_DRIFT_PX = 16
MAX_Y_DRIFT_PX = 18
MAX_WIDTH_DRIFT_PX = 12
MAX_HEIGHT_DRIFT_PX = 10
DEBUG_CROP_MARGIN = 28


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process raster-page NotebookLM watermark cleanup")
    parser.add_argument("--request", type=Path, required=True, help="Process request json path")
    parser.add_argument("--input", type=Path, required=True, help="Input PDF path")
    parser.add_argument("--output", type=Path, required=True, help="Output PDF path")
    parser.add_argument("--report", type=Path, required=True, help="Process report JSON path")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return run_process(args.request, args.input, args.output, args.report)


def run_process(request_path: Path, input_pdf: Path, output_pdf: Path, report_path: Path) -> int:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    output_tmp_pdf = output_pdf.with_name(f"{output_pdf.stem}.tmp{output_pdf.suffix}")
    partial_output_pdf = output_pdf.with_name(f"{output_pdf.stem}.partial{output_pdf.suffix}")
    if output_tmp_pdf.exists():
        output_tmp_pdf.unlink()
    if partial_output_pdf.exists():
        partial_output_pdf.unlink()
    if output_pdf.exists():
        output_pdf.unlink()

    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        config = normalize_config(request.get("rasterProcessConfig"))
        algorithm_profile = str(request.get("algorithmProfile") or "stable-light-complex-v5")
        previous_metrics = request.get("previousMetrics")
        process_debug_path = Path(str(request.get("processDebugPath", report_path.with_name("process-debug.v1.json"))))
        debug_overlay_dir = process_debug_path.parent / "raster-debug-overlays"
        debug_overlay_dir.mkdir(parents=True, exist_ok=True)

        per_page_results: list[dict[str, Any]] = []
        warnings: list[str] = []
        applied_operations: list[dict[str, Any]] = []
        skipped_operations: list[dict[str, Any]] = []
        repair_method_stats: dict[str, int] = {}
        failed_reason_counts: dict[str, int] = {}
        failed_category_counts: dict[str, int] = {}
        second_pass_triggered_page_count = 0

        if not HAS_OPENCV:
            warnings.append("opencv_not_available: degraded_mode_small_local_fill")

        with fitz.open(input_pdf) as source_doc:
            out_doc = fitz.open()
            input_page_count = source_doc.page_count
            dominant_template = build_document_template(source_doc, config)

            for page_index in range(source_doc.page_count):
                page = source_doc.load_page(page_index)
                pix = page.get_pixmap(matrix=fitz.Matrix(config["renderScale"], config["renderScale"]), alpha=False)
                page_info = build_page_info(page, pix)
                fallback_to_original = False
                page_failure_reason: str | None = None

                try:
                    result, output_pix = cleanup_page_pixmap(
                        pix,
                        config=config,
                        page_number=page_index + 1,
                        page_info=page_info,
                        debug_overlay_dir=debug_overlay_dir,
                        dominant_template=dominant_template,
                        degraded_mode=not HAS_OPENCV,
                    )
                except Exception as page_error:  # pylint: disable=broad-except
                    fallback_to_original = True
                    page_failure_reason = str(page_error)
                    output_pix = pix
                    result = {
                        **page_info,
                        "success": False,
                        "reason": "page_exception",
                        "skipReason": "page_exception",
                        "failureReasonDetailed": page_failure_reason,
                        "failureCategory": "watermark removal insufficient",
                        "fallbackChain": ["page_exception", "fallback_to_original"],
                        "note": "Page-level processing exception, fallback to original page.",
                        "repairMethod": "fallback_to_original",
                    }

                if not bool(result.get("success", False)):
                    fallback_to_original = True
                    if page_failure_reason is None:
                        page_failure_reason = str(
                            result.get("failureReasonDetailed")
                            or result.get("skipReason")
                            or result.get("reason")
                            or "unknown_failure"
                        )
                per_page_results.append(
                    {
                        "page": page_index + 1,
                        "pageWidth": result.get("pageWidth"),
                        "pageHeight": result.get("pageHeight"),
                        "renderWidth": result.get("renderWidth"),
                        "renderHeight": result.get("renderHeight"),
                        "cropBox": result.get("cropBox"),
                        "mediaBox": result.get("mediaBox"),
                        "rotation": result.get("rotation"),
                        "roi": result.get("roi"),
                        "detectedWatermarkBox": result.get("detectedWatermarkBox"),
                        "detectedBoxNormalized": result.get("detectedBoxNormalized"),
                        "mappedProcessBox": result.get("mappedProcessBox"),
                        "rawDetectionBox": result.get("rawDetectionBox"),
                        "clampedDetectionBox": result.get("clampedDetectionBox"),
                        "expandedMaskBox": result.get("expandedMaskBox"),
                        "finalMaskBox": result.get("finalMaskBox"),
                        "pageTheme": result.get("pageTheme"),
                        "pageStyleClass": result.get("pageStyleClass"),
                        "repairPolicy": result.get("repairPolicy"),
                        "templateId": result.get("templateId"),
                        "dominantTemplateId": result.get("dominantTemplateId"),
                        "marginRight": result.get("marginRight"),
                        "marginBottom": result.get("marginBottom"),
                        "repairAreaRatio": result.get("repairAreaRatio"),
                        "maskAreaRatioWithinTemplate": result.get("maskAreaRatioWithinTemplate"),
                        "maskHeightRatioWithinTemplate": result.get("maskHeightRatioWithinTemplate"),
                        "templateScore": result.get("templateScore"),
                        "rerunCount": result.get("rerunCount"),
                        "degradedMode": result.get("degradedMode"),
                        "fallbackChain": result.get("fallbackChain"),
                        "glyphBoundingBox": result.get("glyphBoundingBox"),
                        "logoComponentBox": result.get("logoComponentBox"),
                        "fringeBox": result.get("fringeBox"),
                        "conservativeTemplateBox": result.get("conservativeTemplateBox"),
                        "maskGenerationMode": result.get("maskGenerationMode"),
                        "selectedRepairMethod": result.get("selectedRepairMethod"),
                        "blendMode": result.get("blendMode"),
                        "cornerTemplateResidual": result.get("cornerTemplateResidual"),
                        "humanReviewRecommended": result.get("humanReviewRecommended"),
                        "visualVerificationPassed": result.get("visualVerificationPassed"),
                        "removalPassPassed": result.get("removalPassPassed"),
                        "damageControlPassPassed": result.get("damageControlPassPassed"),
                        "structureBreakScore": result.get("structureBreakScore"),
                        "residualWatermarkScore": result.get("residualWatermarkScore"),
                        "brightGlyphResidualScore": result.get("brightGlyphResidualScore"),
                        "edgeTemplateResidualScore": result.get("edgeTemplateResidualScore"),
                        "templateSimilarityBefore": result.get("templateSimilarityBefore"),
                        "templateSimilarityAfter": result.get("templateSimilarityAfter"),
                        "textResidualScore": result.get("textResidualScore"),
                        "damageLumaDelta": result.get("damageLumaDelta"),
                        "brightnessDelta": result.get("brightnessDelta"),
                        "damageTextureDelta": result.get("damageTextureDelta"),
                        "damageSeamScore": result.get("damageSeamScore"),
                        "shrinkStrategy": result.get("shrinkStrategy"),
                        "secondPassTriggered": result.get("secondPassTriggered"),
                        "secondPassBox": result.get("secondPassBox"),
                        "secondPassStrategy": result.get("secondPassStrategy"),
                        "failureReasonDetailed": result.get("failureReasonDetailed"),
                        "failureCategory": result.get("failureCategory"),
                        "residualHotspotBox": result.get("residualHotspotBox"),
                        "trailingCleanupMaskBox": result.get("trailingCleanupMaskBox"),
                        "trailingCleanupApplied": result.get("trailingCleanupApplied"),
                        "trailingFeatherRadius": result.get("trailingFeatherRadius"),
                        "trailingBrightnessMatched": result.get("trailingBrightnessMatched"),
                        "trailingBrightnessBefore": result.get("trailingBrightnessBefore"),
                        "trailingBrightnessAfter": result.get("trailingBrightnessAfter"),
                        "trailingSeamBefore": result.get("trailingSeamBefore"),
                        "trailingSeamAfter": result.get("trailingSeamAfter"),
                        "seamGuardTriggered": result.get("seamGuardTriggered"),
                        "brightnessGuardTriggered": result.get("brightnessGuardTriggered"),
                        "structureProtectionTriggered": result.get("structureProtectionTriggered"),
                        "selectedCandidateReason": result.get("selectedCandidateReason"),
                        "seamRingApplied": result.get("seamRingApplied"),
                        "seamRingWidth": result.get("seamRingWidth"),
                        "seamRingAccepted": result.get("seamRingAccepted"),
                        "seamRingRejectedReason": result.get("seamRingRejectedReason"),
                        "seamRingStructureDense": result.get("seamRingStructureDense"),
                        "seamRingResidualBefore": result.get("seamRingResidualBefore"),
                        "seamRingResidualAfter": result.get("seamRingResidualAfter"),
                        "seamRingTextureBefore": result.get("seamRingTextureBefore"),
                        "seamRingTextureAfter": result.get("seamRingTextureAfter"),
                        "seamRingSeamBefore": result.get("seamRingSeamBefore"),
                        "seamRingSeamAfter": result.get("seamRingSeamAfter"),
                        "seamRingBrightnessBefore": result.get("seamRingBrightnessBefore"),
                        "seamRingBrightnessAfter": result.get("seamRingBrightnessAfter"),
                        "passBeforeSeamRing": result.get("passBeforeSeamRing"),
                        "passAfterSeamRing": result.get("passAfterSeamRing"),
                "passPreservingRollbackTriggered": result.get("passPreservingRollbackTriggered"),
                "v4CandidateFrozen": result.get("v4CandidateFrozen"),
                "seamMicroPolishAttempted": result.get("seamMicroPolishAttempted"),
                "seamMicroPolishApplied": result.get("seamMicroPolishApplied"),
                "seamMicroPolishAccepted": result.get("seamMicroPolishAccepted"),
                "seamMicroPolishRejectedReason": result.get("seamMicroPolishRejectedReason"),
                "seamMicroPolishRingWidth": result.get("seamMicroPolishRingWidth"),
                "seamMicroPolishAlphaDelta": result.get("seamMicroPolishAlphaDelta"),
                "seamMicroPolishReferenceMode": result.get("seamMicroPolishReferenceMode"),
                "seamMicroPolishResidualBefore": result.get("seamMicroPolishResidualBefore"),
                "seamMicroPolishResidualAfter": result.get("seamMicroPolishResidualAfter"),
                "seamMicroPolishTextureBefore": result.get("seamMicroPolishTextureBefore"),
                "seamMicroPolishTextureAfter": result.get("seamMicroPolishTextureAfter"),
                "seamMicroPolishSeamBefore": result.get("seamMicroPolishSeamBefore"),
                "seamMicroPolishSeamAfter": result.get("seamMicroPolishSeamAfter"),
                "seamMicroPolishBrightnessBefore": result.get("seamMicroPolishBrightnessBefore"),
                "seamMicroPolishBrightnessAfter": result.get("seamMicroPolishBrightnessAfter"),
                "passBeforeV6": result.get("passBeforeV6"),
                "passAfterV6": result.get("passAfterV6"),
                "v5PassedBecameFailedCount": result.get("v5PassedBecameFailedCount"),
                "v6RollbackTriggered": result.get("v6RollbackTriggered"),
                "textureSurgeAbortTriggered": result.get("textureSurgeAbortTriggered"),
                "abortedCandidateName": result.get("abortedCandidateName"),
                "textureDeltaIncrease": result.get("textureDeltaIncrease"),
                "fallbackCandidateName": result.get("fallbackCandidateName"),
                "lightComplexCandidates": result.get("lightComplexCandidates"),
                "wasClamped": result.get("wasClamped"),
                        "wasShrunk": result.get("wasShrunk"),
                        "skipReason": result.get("skipReason"),
                        "analyzeOverlayPath": result.get("analyzeOverlayPath"),
                        "processOverlayPath": result.get("processOverlayPath"),
                        "debugArtifacts": result.get("debugArtifacts"),
                        "repairMethod": result.get("repairMethod"),
                        "success": bool(result.get("success", False)),
                        "fallbackToOriginal": fallback_to_original,
                        "failureReason": page_failure_reason,
                        "reason": result.get("reason"),
                        "note": result.get("note"),
                    }
                )
                if result.get("secondPassTriggered"):
                    second_pass_triggered_page_count += 1
                if result.get("success"):
                    method = str(result.get("repairMethod", "unknown"))
                    repair_method_stats[method] = repair_method_stats.get(method, 0) + 1
                    applied_operations.append(
                        {
                            "candidateId": "raster-page",
                            "anchorId": f"raster-page:p{page_index + 1}",
                            "operation": method,
                            "page": page_index + 1,
                            "success": True,
                            "detail": {
                                "mode": "raster_repair_v1",
                                "detectedWatermarkBox": result.get("detectedWatermarkBox"),
                            },
                        }
                    )
                else:
                    failure_reason = str(
                        result.get("failureReasonDetailed")
                        or result.get("skipReason")
                        or result.get("reason")
                        or "unknown_failure"
                    )
                    failed_reason_counts[failure_reason] = failed_reason_counts.get(failure_reason, 0) + 1
                    failure_category = str(result.get("failureCategory") or "watermark removal insufficient")
                    failed_category_counts[failure_category] = failed_category_counts.get(failure_category, 0) + 1
                    skipped_operations.append(
                        {
                            "candidateId": "raster-page",
                            "anchorId": f"raster-page:p{page_index + 1}",
                            "page": page_index + 1,
                            "reason": str(result.get("reason", "no_instruction_removed")),
                            "detail": {
                                "stage": "raster_repair",
                                "note": result.get("note", ""),
                            },
                        }
                    )

                new_page = out_doc.new_page(width=page.rect.width, height=page.rect.height)
                new_page.insert_image(new_page.rect, pixmap=output_pix)

            output_page_count = out_doc.page_count
            if output_page_count > 0:
                out_doc.save(output_tmp_pdf, deflate=True, garbage=3)
            elif output_pdf.exists():
                output_pdf.unlink()
            out_doc.close()

            if output_page_count == input_page_count and output_page_count > 0:
                output_tmp_pdf.replace(output_pdf)
            else:
                if output_tmp_pdf.exists():
                    output_tmp_pdf.replace(partial_output_pdf)
                if output_pdf.exists():
                    output_pdf.unlink()

        repaired_page_count = sum(1 for row in per_page_results if row.get("success"))
        skipped_page_count = len(per_page_results) - repaired_page_count

        current_metrics = build_quality_metrics(
            candidate_count=1,
            attempted_operation_count=len(per_page_results),
            applied_operation_count=repaired_page_count,
            no_instruction_removed_count=skipped_page_count,
        )
        report_payload = {
            "processedAt": iso_now(),
            "algorithmProfile": algorithm_profile,
            "processMode": "raster_repair_v1",
            "selectedCandidates": request.get("selection", []),
            "appliedOperations": applied_operations,
            "skippedOperations": skipped_operations,
            "skippedReasons": count_reasons(skipped_operations),
            "inputPageCount": input_page_count,
            "outputPageCount": output_page_count,
            "processedPageCount": len(per_page_results),
            "repairedPageCount": repaired_page_count,
            "skippedPageCount": skipped_page_count,
            "failedPageCount": skipped_page_count,
            "secondPassTriggeredPageCount": second_pass_triggered_page_count,
            "failedReasonCounts": failed_reason_counts,
            "failedCategoryCounts": failed_category_counts,
            "watermarkDetectionMode": "notebooklm_template_constrained_right_bottom_mask",
            "dominantTemplateId": dominant_template.template_id,
            "perPageResults": per_page_results,
            "repairMethodStats": repair_method_stats,
            "warnings": warnings,
            "qualityMetrics": current_metrics,
            "metricsComparison": build_metrics_comparison(previous_metrics, current_metrics),
            "overallVisualSuccess": repaired_page_count > 0,
            "status": "success" if repaired_page_count > 0 else "failed_visual_verification",
        }
        if output_page_count != input_page_count:
            report_payload["status"] = "fatal_error"
            report_payload["fatalError"] = (
                f"output page count mismatch: input={input_page_count}, output={output_page_count}"
            )
        report_path.write_text(
            json.dumps(report_payload, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        if output_page_count != input_page_count:
            return 3
        return 0
    except Exception as error:  # pylint: disable=broad-except
        if output_tmp_pdf.exists():
            output_tmp_pdf.unlink()
        if output_pdf.exists():
            output_pdf.unlink()
        fatal_report = {
            "processedAt": iso_now(),
            "algorithmProfile": str(request.get("algorithmProfile") or "stable-light-complex-v5")
            if isinstance(locals().get("request"), dict)
            else "stable-light-complex-v5",
            "processMode": "raster_repair_v1",
            "selectedCandidates": [],
            "appliedOperations": [],
            "skippedOperations": [],
            "skippedReasons": {},
            "inputPageCount": 0,
            "outputPageCount": 0,
            "processedPageCount": 0,
            "repairedPageCount": 0,
            "skippedPageCount": 0,
            "failedPageCount": 0,
            "secondPassTriggeredPageCount": 0,
            "failedReasonCounts": {},
            "failedCategoryCounts": {},
            "watermarkDetectionMode": "notebooklm_template_constrained_right_bottom_mask",
            "perPageResults": [],
            "repairMethodStats": {},
            "warnings": [],
            "qualityMetrics": build_quality_metrics(
                candidate_count=0,
                attempted_operation_count=0,
                applied_operation_count=0,
                no_instruction_removed_count=0,
            ),
            "metricsComparison": None,
            "overallVisualSuccess": False,
            "status": "fatal_error",
            "fatalError": str(error),
        }
        report_path.write_text(
            json.dumps(fatal_report, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        return 2


def normalize_config(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    roi = data.get("roi") if isinstance(data.get("roi"), dict) else {}
    render_scale = float(data.get("renderScale", 2.5))
    enable_seam_micro_polish = bool(data.get("enableSeamMicroPolish", False))
    return {
        "renderScale": min(3.0, max(2.0, render_scale)),
        "roiWidthRatio": min(SEARCH_X_MAX - SEARCH_X_MIN, max(0.08, float(roi.get("widthRatio", 0.13)))),
        "roiHeightRatio": min(SEARCH_Y_MAX - SEARCH_Y_MIN, max(0.05, float(roi.get("heightRatio", 0.095)))),
        "enableSeamMicroPolish": enable_seam_micro_polish,
    }


def build_document_template(source_doc: fitz.Document, config: dict[str, Any]) -> TemplateLock:
    samples: list[TemplateLock] = []
    sample_count = min(5, source_doc.page_count)
    for page_index in range(sample_count):
        page = source_doc.load_page(page_index)
        pix = page.get_pixmap(matrix=fitz.Matrix(config["renderScale"], config["renderScale"]), alpha=False)
        if pix.n < 3:
            continue
        source = bytearray(bytes(pix.samples))
        roi = build_roi_candidates(pix.width, pix.height, config)[0]
        page_theme = classify_page_theme(source, pix.width, pix.height, pix.n, roi)
        detection = detect_watermark_box(
            source,
            pix.width,
            pix.height,
            pix.n,
            roi,
            page_theme=page_theme,
            dominant_template=None,
        )
        if detection is None:
            continue
        box = detection["box"]
        template_id, template_width, template_height = nearest_template(box.width, box.height)
        samples.append(
            TemplateLock(
                template_id=template_id,
                width=template_width,
                height=template_height,
                margin_right=max(0, pix.width - box.x - box.width),
                margin_bottom=max(0, pix.height - box.y - box.height),
                score=float(detection.get("templateScore", 0)),
            )
        )

    if not samples:
        return TemplateLock("template_wide", 268, 69, 36, 18, 0)

    grouped: dict[str, list[TemplateLock]] = {}
    for sample in samples:
        grouped.setdefault(sample.template_id, []).append(sample)
    dominant_id, dominant_samples = max(
        grouped.items(),
        key=lambda row: (len(row[1]), sum(item.score for item in row[1]) / max(1, len(row[1]))),
    )
    spec = TEMPLATE_SPECS[dominant_id]
    return TemplateLock(
        template_id=dominant_id,
        width=int(spec["width"]),
        height=int(spec["height"]),
        margin_right=int(median([item.margin_right for item in dominant_samples])),
        margin_bottom=int(median([item.margin_bottom for item in dominant_samples])),
        score=round(sum(item.score for item in dominant_samples) / max(1, len(dominant_samples)), 4),
    )


def cleanup_page_pixmap(
    pix: fitz.Pixmap,
    *,
    config: dict[str, Any],
    page_number: int,
    page_info: dict[str, Any],
    debug_overlay_dir: Path,
    dominant_template: TemplateLock,
    degraded_mode: bool,
) -> tuple[dict[str, Any], fitz.Pixmap]:
    width = pix.width
    height = pix.height
    channel = pix.n
    base_result = {
        **page_info,
        "renderWidth": width,
        "renderHeight": height,
        "dominantTemplateId": dominant_template.template_id,
        "degradedMode": degraded_mode,
    }
    if channel < 3:
        return (
            {
                **base_result,
                "success": False,
                "reason": "unsupported_color_space",
                "skipReason": "unsupported_color_space",
                "repairPolicy": "unsupported_skip",
                "failureCategory": "watermark removal insufficient",
                "fallbackChain": ["skip:unsupported_color_space"],
                "note": "Pixmap channel count is below RGB.",
            },
            pix,
        )

    source = bytes(pix.samples)
    roi_candidates = build_roi_candidates(width, height, config)
    page_theme = classify_page_theme(bytearray(source), width, height, channel, roi_candidates[0])

    detection = None
    for roi in roi_candidates:
        candidate = detect_watermark_box(
            bytearray(source),
            width,
            height,
            channel,
            roi,
            page_theme=page_theme,
            dominant_template=dominant_template,
        )
        if candidate is not None:
            detection = candidate
            break

    if detection is None:
        analyze_overlay_path = save_debug_overlay(
            source,
            width,
            height,
            channel,
            debug_overlay_dir / f"page-{page_number:03d}-analyze-overlay.png",
            boxes=[(roi_candidates[0], (255, 192, 0))],
            points=set(),
        )
        process_overlay_path = save_debug_overlay(
            source,
            width,
            height,
            channel,
            debug_overlay_dir / f"page-{page_number:03d}-process-overlay.png",
            boxes=[(roi_candidates[0], (255, 192, 0))],
            points=set(),
        )
        debug_artifacts = save_debug_artifacts(
            source,
            source,
            source,
            width,
            height,
            channel,
            roi_candidates[0],
            roi_candidates[0],
            roi_candidates[0],
            set(),
            "mixed_structure",
            debug_overlay_dir / f"page-{page_number:03d}",
        )
        return (
            {
                **base_result,
                "success": False,
                "roi": box_to_json(roi_candidates[0]),
                "reason": "no_instruction_removed",
                "skipReason": "no_template_watermark_mask",
                "pageTheme": page_theme,
                "pageStyleClass": "mixed_structure",
                "repairPolicy": style_repair_policy("mixed_structure"),
                "templateId": dominant_template.template_id,
                "marginRight": dominant_template.margin_right,
                "marginBottom": dominant_template.margin_bottom,
                "repairAreaRatio": 0,
                "maskAreaRatioWithinTemplate": 0,
                "maskHeightRatioWithinTemplate": 0,
                "templateScore": 0,
                "rerunCount": 0,
                "fallbackChain": ["skip:no_template_watermark_mask"],
                "failureCategory": "watermark removal insufficient",
                "wasClamped": False,
                "wasShrunk": False,
                "analyzeOverlayPath": str(analyze_overlay_path),
                "processOverlayPath": str(process_overlay_path),
                "debugArtifacts": debug_artifacts,
                "note": "No NotebookLM-sized watermark mask was detected in the constrained right-bottom template window.",
            },
            pix,
        )

    watermark_box = detection["box"]
    mask_points = detection["maskPoints"]
    detected_box_normalized = detection["normalizedBox"]
    mapped_process_box = map_normalized_box_to_render(detected_box_normalized, width, height)
    analyze_overlay_path = save_debug_overlay(
        source,
        width,
        height,
        channel,
        debug_overlay_dir / f"page-{page_number:03d}-analyze-overlay.png",
        boxes=[(detection["rawBox"], (255, 64, 64)), (mapped_process_box, (64, 128, 255))],
        points=set(),
    )
    process_overlay_path = save_debug_overlay(
        source,
        width,
        height,
        channel,
        debug_overlay_dir / f"page-{page_number:03d}-process-overlay.png",
        boxes=[(mapped_process_box, (64, 128, 255)), (detection["maskBox"], (64, 220, 96))],
        points=mask_points,
    )
    page_style_class = classify_page_style(source, width, height, channel, watermark_box)
    repair_policy = style_repair_policy(page_style_class)
    mutable = bytearray(source)
    light_complex_candidates: list[dict[str, Any]] = []
    if page_style_class == "light_complex_diagram":
        candidate_result = run_light_complex_diagram_repair_v1(
            source,
            width=width,
            height=height,
            channel=channel,
            detection=detection,
            page_theme=page_theme,
            degraded_mode=degraded_mode,
            enable_seam_micro_polish=bool(config.get("enableSeamMicroPolish", False)),
        )
        method = candidate_result["method"]
        fallback_chain = [*candidate_result["fallbackChain"], f"selected:{candidate_result['candidateId']}"]
        mutable = bytearray(candidate_result["pixels"])
        pass1_output = bytearray(source)
        visual_verification = candidate_result["verification"]
        light_complex_candidates = candidate_result.get("candidates", [])
        detection["maskBox"] = candidate_result["maskBox"]
        mask_points = candidate_result["maskPoints"]
        detection["repairAreaRatio"] = round(len(mask_points) / max(1, width * height), 6)
        detection["maskAreaRatioWithinTemplate"] = round(
            len(mask_points) / max(1, detection["maskBox"].width * detection["maskBox"].height),
            6,
        )
        detection["maskHeightRatioWithinTemplate"] = round(
            detection["maskBox"].height / max(1, detection["expandedMaskBox"].height),
            6,
        )
        second_pass_triggered = False
        second_pass_box = detection["maskBox"]
        second_pass_strategy = candidate_result["candidateId"]
        failure_reason_detailed = None if visual_verification["passed"] else "failed_visual_verification"
    else:
        method, fallback_chain = apply_repair(
            source,
            mutable,
            width,
            height,
            channel,
            watermark_box,
            mask_points,
            detection["maskBox"],
            page_theme,
            degraded_mode,
            page_style_class=page_style_class,
        )
        pass1_output = bytes(mutable)
        visual_verification = (
            verify_residual_watermark(
                source,
                pass1_output,
                width,
                height,
                channel,
                watermark_box,
                detection["maskBox"],
                detection["polarity"],
                detection["threshold"],
                detection["baselineResidualScore"],
            )
            if method is not None
            else default_failed_verification()
        )
        second_pass_triggered = False
        second_pass_box = None
        second_pass_strategy = None
        failure_reason_detailed = None
        if method is not None and not visual_verification["passed"]:
            second_pass_triggered = True
            second_pass_box = expand_box_for_second_pass(detection["maskBox"], width, height)
            second_mask_points = box_to_points(second_pass_box)
            if second_mask_points:
                second_mutable = bytearray(source)
                second_method, second_chain = apply_repair(
                    source,
                    second_mutable,
                    width,
                    height,
                    channel,
                    second_pass_box,
                    second_mask_points,
                    second_pass_box,
                    page_theme,
                    degraded_mode,
                    aggressive=True,
                    page_style_class=page_style_class,
                )
                if second_method is not None:
                    second_pass_strategy = second_method
                    second_visual_verification = verify_residual_watermark(
                        source,
                        bytes(second_mutable),
                        width,
                        height,
                        channel,
                        second_pass_box,
                        second_pass_box,
                        detection["polarity"],
                        detection["threshold"],
                        detection["baselineResidualScore"],
                    )
                    if second_visual_verification["passed"] or (
                        second_visual_verification["residualWatermarkScore"]
                        < visual_verification["residualWatermarkScore"]
                    ):
                        method = second_method
                        mutable = second_mutable
                        fallback_chain = [*fallback_chain, "second_pass", *second_chain]
                        mask_points = second_mask_points
                        detection["maskBox"] = second_pass_box
                        detection["repairAreaRatio"] = round(len(second_mask_points) / max(1, width * height), 6)
                        detection["maskAreaRatioWithinTemplate"] = round(
                            len(second_mask_points) / max(1, second_pass_box.width * second_pass_box.height),
                            6,
                        )
                        detection["maskHeightRatioWithinTemplate"] = round(
                            detection["maskBox"].height / max(1, second_pass_box.height),
                            6,
                        )
                        detection["rerunCount"] = int(detection["rerunCount"]) + 1
                        visual_verification = second_visual_verification
            if not visual_verification["passed"]:
                failure_reason_detailed = "failed_visual_verification"
                fallback_chain = [*fallback_chain, "failed_visual_verification"]
    process_overlay_path = save_debug_overlay(
        source,
        width,
        height,
        channel,
        debug_overlay_dir / f"page-{page_number:03d}-process-overlay.png",
        boxes=[
            (second_pass_box if second_pass_box else mapped_process_box, (64, 128, 255)),
            (detection["maskBox"], (64, 220, 96)),
        ],
        points=mask_points,
    )
    debug_artifacts = save_debug_artifacts(
        source,
        pass1_output,
        bytes(mutable),
        width,
        height,
        channel,
        watermark_box,
        second_pass_box if second_pass_box else detection["maskBox"],
        detection["maskBox"],
        mask_points,
        page_style_class,
        debug_overlay_dir / f"page-{page_number:03d}",
    )
    if page_style_class == "light_complex_diagram" and candidate_result.get("seamRingPoints"):
        seam_ring_overlay_path = save_debug_overlay(
            source,
            width,
            height,
            channel,
            debug_overlay_dir / f"page-{page_number:03d}-seam-ring-overlay.png",
            boxes=[
                (
                    candidate_result["trailingCleanupMaskBox"],
                    (255, 176, 0),
                )
            ]
            if isinstance(candidate_result.get("trailingCleanupMaskBox"), Box)
            else [],
            points=set(candidate_result.get("seamRingPoints", set())),
        )
        debug_artifacts["seamRingOverlayPath"] = str(seam_ring_overlay_path)
    if page_style_class == "light_complex_diagram" and candidate_result.get("seamMicroPolishPoints"):
        micro_overlay_path = save_debug_overlay(
            source,
            width,
            height,
            channel,
            debug_overlay_dir / f"page-{page_number:03d}-seam-micro-polish-overlay.png",
            boxes=[
                (
                    candidate_result["trailingCleanupMaskBox"],
                    (200, 90, 255),
                )
            ]
            if isinstance(candidate_result.get("trailingCleanupMaskBox"), Box)
            else [],
            points=set(candidate_result.get("seamMicroPolishPoints", set())),
        )
        debug_artifacts["seamMicroPolishOverlayPath"] = str(micro_overlay_path)
    if method is None:
        failure_reason_detailed = failure_reason_detailed or "repair_method_failed"
        failure_category = infer_failure_category(
            page_style_class,
            visual_verification,
            skip_reason="repair_method_failed",
        )
        return (
            {
                **base_result,
                "success": False,
                "roi": box_to_json(detection["roi"]),
                "rawDetectionBox": box_to_json(detection["rawBox"]),
                "clampedDetectionBox": box_to_json(watermark_box),
                "expandedMaskBox": box_to_json(second_pass_box) if second_pass_box else box_to_json(detection["expandedMaskBox"]),
                "finalMaskBox": box_to_json(detection["maskBox"]),
                "detectedWatermarkBox": box_to_json(watermark_box),
                "detectedBoxNormalized": detected_box_normalized,
                "mappedProcessBox": box_to_json(mapped_process_box),
                "pageTheme": page_theme,
                "pageStyleClass": page_style_class,
                "repairPolicy": repair_policy,
                "templateId": detection["templateId"],
                "dominantTemplateId": dominant_template.template_id,
                "marginRight": detection["marginRight"],
                "marginBottom": detection["marginBottom"],
                "repairAreaRatio": detection["repairAreaRatio"],
                "maskAreaRatioWithinTemplate": detection["maskAreaRatioWithinTemplate"],
                "maskHeightRatioWithinTemplate": detection["maskHeightRatioWithinTemplate"],
                "templateScore": detection["templateScore"],
                "rerunCount": detection["rerunCount"],
                "degradedMode": degraded_mode,
                "fallbackChain": [*detection["fallbackChain"], *fallback_chain, "skip:repair_method_failed"],
                "glyphBoundingBox": box_to_json(detection["glyphBox"]) if detection.get("glyphBox") else None,
                "logoComponentBox": box_to_json(detection["logoBox"]) if detection.get("logoBox") else None,
                "fringeBox": box_to_json(detection["fringeBox"]) if detection.get("fringeBox") else None,
                "conservativeTemplateBox": box_to_json(detection["conservativeTemplateBox"]),
                "maskGenerationMode": detection["maskGenerationMode"],
                "selectedRepairMethod": method,
                "blendMode": fallback_chain[-1] if fallback_chain else None,
                "cornerTemplateResidual": visual_verification["cornerTemplateResidual"],
                "humanReviewRecommended": True,
                "visualVerificationPassed": False,
                "removalPassPassed": visual_verification["removalPassPassed"],
                "damageControlPassPassed": visual_verification["damageControlPassPassed"],
                "structureBreakScore": visual_verification.get("structureBreakScore"),
                "residualWatermarkScore": visual_verification["residualWatermarkScore"],
                "brightGlyphResidualScore": visual_verification["brightGlyphResidualScore"],
                "edgeTemplateResidualScore": visual_verification["edgeTemplateResidualScore"],
                "templateSimilarityBefore": visual_verification["templateSimilarityBefore"],
                "templateSimilarityAfter": visual_verification["templateSimilarityAfter"],
                "textResidualScore": visual_verification["textResidualScore"],
                "damageLumaDelta": visual_verification["damageLumaDelta"],
                "brightnessDelta": visual_verification["brightnessDelta"],
                "damageTextureDelta": visual_verification["damageTextureDelta"],
                "damageSeamScore": visual_verification["damageSeamScore"],
                "shrinkStrategy": detection["shrinkStrategy"],
                "secondPassTriggered": second_pass_triggered,
                "secondPassBox": box_to_json(second_pass_box) if second_pass_box else None,
                "secondPassStrategy": second_pass_strategy,
                "failureReasonDetailed": failure_reason_detailed,
                "failureCategory": failure_category,
                "residualHotspotBox": box_to_json(candidate_result["residualHotspotBox"])
                if page_style_class == "light_complex_diagram" and isinstance(candidate_result.get("residualHotspotBox"), Box)
                else None,
                "trailingCleanupMaskBox": box_to_json(candidate_result["trailingCleanupMaskBox"])
                if page_style_class == "light_complex_diagram" and isinstance(candidate_result.get("trailingCleanupMaskBox"), Box)
                else None,
                "trailingCleanupApplied": bool(candidate_result.get("trailingCleanupApplied"))
                if page_style_class == "light_complex_diagram"
                else False,
                "trailingFeatherRadius": int(candidate_result.get("trailingFeatherRadius") or 0)
                if page_style_class == "light_complex_diagram"
                else 0,
                "trailingBrightnessMatched": bool(candidate_result.get("trailingBrightnessMatched"))
                if page_style_class == "light_complex_diagram"
                else False,
                "trailingBrightnessBefore": float(candidate_result.get("trailingBrightnessBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "trailingBrightnessAfter": float(candidate_result.get("trailingBrightnessAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "trailingSeamBefore": float(candidate_result.get("trailingSeamBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "trailingSeamAfter": float(candidate_result.get("trailingSeamAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamGuardTriggered": bool(candidate_result.get("seamGuardTriggered"))
                if page_style_class == "light_complex_diagram"
                else False,
                "brightnessGuardTriggered": bool(candidate_result.get("brightnessGuardTriggered"))
                if page_style_class == "light_complex_diagram"
                else False,
                "structureProtectionTriggered": bool(candidate_result.get("structureProtectionTriggered"))
                if page_style_class == "light_complex_diagram"
                else False,
                "selectedCandidateReason": str(candidate_result.get("selectedCandidateReason") or "")
                if page_style_class == "light_complex_diagram"
                else "",
                "seamRingApplied": bool(candidate_result.get("seamRingApplied"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamRingWidth": int(candidate_result.get("seamRingWidth") or 0)
                if page_style_class == "light_complex_diagram"
                else 0,
                "seamRingAccepted": bool(candidate_result.get("seamRingAccepted"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamRingRejectedReason": str(candidate_result.get("seamRingRejectedReason") or "")
                if page_style_class == "light_complex_diagram"
                else "",
                "seamRingStructureDense": bool(candidate_result.get("seamRingStructureDense"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamRingResidualBefore": float(candidate_result.get("seamRingResidualBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingResidualAfter": float(candidate_result.get("seamRingResidualAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingTextureBefore": float(candidate_result.get("seamRingTextureBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingTextureAfter": float(candidate_result.get("seamRingTextureAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingSeamBefore": float(candidate_result.get("seamRingSeamBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingSeamAfter": float(candidate_result.get("seamRingSeamAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingBrightnessBefore": float(candidate_result.get("seamRingBrightnessBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamRingBrightnessAfter": float(candidate_result.get("seamRingBrightnessAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "passBeforeSeamRing": bool(candidate_result.get("passBeforeSeamRing"))
                if page_style_class == "light_complex_diagram"
                else False,
                "passAfterSeamRing": bool(candidate_result.get("passAfterSeamRing"))
                if page_style_class == "light_complex_diagram"
                else False,
                "passPreservingRollbackTriggered": bool(candidate_result.get("passPreservingRollbackTriggered"))
                if page_style_class == "light_complex_diagram"
                else False,
                "v4CandidateFrozen": bool(candidate_result.get("v4CandidateFrozen"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamMicroPolishAttempted": bool(candidate_result.get("seamMicroPolishAttempted"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamMicroPolishApplied": bool(candidate_result.get("seamMicroPolishApplied"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamMicroPolishAccepted": bool(candidate_result.get("seamMicroPolishAccepted"))
                if page_style_class == "light_complex_diagram"
                else False,
                "seamMicroPolishRejectedReason": str(candidate_result.get("seamMicroPolishRejectedReason") or "")
                if page_style_class == "light_complex_diagram"
                else "",
                "seamMicroPolishRingWidth": int(candidate_result.get("seamMicroPolishRingWidth") or 0)
                if page_style_class == "light_complex_diagram"
                else 0,
                "seamMicroPolishAlphaDelta": float(candidate_result.get("seamMicroPolishAlphaDelta") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishReferenceMode": str(candidate_result.get("seamMicroPolishReferenceMode") or "")
                if page_style_class == "light_complex_diagram"
                else "",
                "seamMicroPolishResidualBefore": float(candidate_result.get("seamMicroPolishResidualBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishResidualAfter": float(candidate_result.get("seamMicroPolishResidualAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishTextureBefore": float(candidate_result.get("seamMicroPolishTextureBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishTextureAfter": float(candidate_result.get("seamMicroPolishTextureAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishSeamBefore": float(candidate_result.get("seamMicroPolishSeamBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishSeamAfter": float(candidate_result.get("seamMicroPolishSeamAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishBrightnessBefore": float(candidate_result.get("seamMicroPolishBrightnessBefore") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "seamMicroPolishBrightnessAfter": float(candidate_result.get("seamMicroPolishBrightnessAfter") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "passBeforeV6": bool(candidate_result.get("passBeforeV6"))
                if page_style_class == "light_complex_diagram"
                else False,
                "passAfterV6": bool(candidate_result.get("passAfterV6"))
                if page_style_class == "light_complex_diagram"
                else False,
                "v5PassedBecameFailedCount": int(candidate_result.get("v5PassedBecameFailedCount") or 0)
                if page_style_class == "light_complex_diagram"
                else 0,
                "v6RollbackTriggered": bool(candidate_result.get("v6RollbackTriggered"))
                if page_style_class == "light_complex_diagram"
                else False,
                "textureSurgeAbortTriggered": bool(candidate_result.get("textureSurgeAbortTriggered"))
                if page_style_class == "light_complex_diagram"
                else False,
                "abortedCandidateName": str(candidate_result.get("abortedCandidateName") or "")
                if page_style_class == "light_complex_diagram"
                else "",
                "textureDeltaIncrease": float(candidate_result.get("textureDeltaIncrease") or 0.0)
                if page_style_class == "light_complex_diagram"
                else 0.0,
                "fallbackCandidateName": str(candidate_result.get("fallbackCandidateName") or "")
                if page_style_class == "light_complex_diagram"
                else "",
                "lightComplexCandidates": light_complex_candidates if page_style_class == "light_complex_diagram" else [],
                "wasClamped": detection["wasClamped"],
                "wasShrunk": detection["wasShrunk"],
                "skipReason": "repair_method_failed",
                "analyzeOverlayPath": str(analyze_overlay_path),
                "processOverlayPath": str(process_overlay_path),
                "debugArtifacts": debug_artifacts,
                "reason": "no_instruction_removed",
                "note": "Repair method fallback failed.",
            },
            pix,
        )

    output = fitz.Pixmap(fitz.csRGB, width, height, bytes(mutable), False)
    success = bool(visual_verification["passed"])
    failure_category = None
    if not success:
        failure_category = infer_failure_category(
            page_style_class,
            visual_verification,
            skip_reason="failed_visual_verification",
        )
    return (
        {
            **base_result,
            "success": success,
            "roi": box_to_json(detection["roi"]),
            "rawDetectionBox": box_to_json(detection["rawBox"]),
            "clampedDetectionBox": box_to_json(watermark_box),
            "expandedMaskBox": box_to_json(second_pass_box) if second_pass_box else box_to_json(detection["expandedMaskBox"]),
            "finalMaskBox": box_to_json(detection["maskBox"]),
            "detectedWatermarkBox": box_to_json(watermark_box),
            "detectedBoxNormalized": detected_box_normalized,
            "mappedProcessBox": box_to_json(mapped_process_box),
            "pageTheme": page_theme,
            "pageStyleClass": page_style_class,
            "repairPolicy": repair_policy,
            "templateId": detection["templateId"],
            "dominantTemplateId": dominant_template.template_id,
            "marginRight": detection["marginRight"],
            "marginBottom": detection["marginBottom"],
            "repairAreaRatio": detection["repairAreaRatio"],
            "maskAreaRatioWithinTemplate": detection["maskAreaRatioWithinTemplate"],
            "maskHeightRatioWithinTemplate": detection["maskHeightRatioWithinTemplate"],
            "templateScore": detection["templateScore"],
            "rerunCount": detection["rerunCount"],
            "degradedMode": degraded_mode,
            "fallbackChain": [*detection["fallbackChain"], *fallback_chain],
            "glyphBoundingBox": box_to_json(detection["glyphBox"]) if detection.get("glyphBox") else None,
            "logoComponentBox": box_to_json(detection["logoBox"]) if detection.get("logoBox") else None,
            "fringeBox": box_to_json(detection["fringeBox"]) if detection.get("fringeBox") else None,
            "conservativeTemplateBox": box_to_json(detection["conservativeTemplateBox"]),
            "maskGenerationMode": detection["maskGenerationMode"],
            "selectedRepairMethod": method,
            "blendMode": fallback_chain[-1] if fallback_chain else None,
            "cornerTemplateResidual": visual_verification["cornerTemplateResidual"],
            "humanReviewRecommended": not success,
            "visualVerificationPassed": success,
            "removalPassPassed": visual_verification["removalPassPassed"],
            "damageControlPassPassed": visual_verification["damageControlPassPassed"],
            "structureBreakScore": visual_verification.get("structureBreakScore"),
            "residualWatermarkScore": visual_verification["residualWatermarkScore"],
            "brightGlyphResidualScore": visual_verification["brightGlyphResidualScore"],
            "edgeTemplateResidualScore": visual_verification["edgeTemplateResidualScore"],
            "templateSimilarityBefore": visual_verification["templateSimilarityBefore"],
            "templateSimilarityAfter": visual_verification["templateSimilarityAfter"],
            "textResidualScore": visual_verification["textResidualScore"],
            "damageLumaDelta": visual_verification["damageLumaDelta"],
            "brightnessDelta": visual_verification["brightnessDelta"],
            "damageTextureDelta": visual_verification["damageTextureDelta"],
            "damageSeamScore": visual_verification["damageSeamScore"],
            "shrinkStrategy": detection["shrinkStrategy"],
            "secondPassTriggered": second_pass_triggered,
            "secondPassBox": box_to_json(second_pass_box) if second_pass_box else None,
            "secondPassStrategy": second_pass_strategy,
            "failureReasonDetailed": failure_reason_detailed,
            "failureCategory": failure_category,
            "residualHotspotBox": box_to_json(candidate_result["residualHotspotBox"])
            if page_style_class == "light_complex_diagram" and isinstance(candidate_result.get("residualHotspotBox"), Box)
            else None,
            "trailingCleanupMaskBox": box_to_json(candidate_result["trailingCleanupMaskBox"])
            if page_style_class == "light_complex_diagram" and isinstance(candidate_result.get("trailingCleanupMaskBox"), Box)
            else None,
            "trailingCleanupApplied": bool(candidate_result.get("trailingCleanupApplied"))
            if page_style_class == "light_complex_diagram"
            else False,
            "trailingFeatherRadius": int(candidate_result.get("trailingFeatherRadius") or 0)
            if page_style_class == "light_complex_diagram"
            else 0,
            "trailingBrightnessMatched": bool(candidate_result.get("trailingBrightnessMatched"))
            if page_style_class == "light_complex_diagram"
            else False,
            "trailingBrightnessBefore": float(candidate_result.get("trailingBrightnessBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "trailingBrightnessAfter": float(candidate_result.get("trailingBrightnessAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "trailingSeamBefore": float(candidate_result.get("trailingSeamBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "trailingSeamAfter": float(candidate_result.get("trailingSeamAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamGuardTriggered": bool(candidate_result.get("seamGuardTriggered"))
            if page_style_class == "light_complex_diagram"
            else False,
            "brightnessGuardTriggered": bool(candidate_result.get("brightnessGuardTriggered"))
            if page_style_class == "light_complex_diagram"
            else False,
            "structureProtectionTriggered": bool(candidate_result.get("structureProtectionTriggered"))
            if page_style_class == "light_complex_diagram"
            else False,
            "selectedCandidateReason": str(candidate_result.get("selectedCandidateReason") or "")
            if page_style_class == "light_complex_diagram"
            else "",
            "seamRingApplied": bool(candidate_result.get("seamRingApplied"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamRingWidth": int(candidate_result.get("seamRingWidth") or 0)
            if page_style_class == "light_complex_diagram"
            else 0,
            "seamRingAccepted": bool(candidate_result.get("seamRingAccepted"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamRingRejectedReason": str(candidate_result.get("seamRingRejectedReason") or "")
            if page_style_class == "light_complex_diagram"
            else "",
            "seamRingStructureDense": bool(candidate_result.get("seamRingStructureDense"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamRingResidualBefore": float(candidate_result.get("seamRingResidualBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingResidualAfter": float(candidate_result.get("seamRingResidualAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingTextureBefore": float(candidate_result.get("seamRingTextureBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingTextureAfter": float(candidate_result.get("seamRingTextureAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingSeamBefore": float(candidate_result.get("seamRingSeamBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingSeamAfter": float(candidate_result.get("seamRingSeamAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingBrightnessBefore": float(candidate_result.get("seamRingBrightnessBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamRingBrightnessAfter": float(candidate_result.get("seamRingBrightnessAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "passBeforeSeamRing": bool(candidate_result.get("passBeforeSeamRing"))
            if page_style_class == "light_complex_diagram"
            else False,
            "passAfterSeamRing": bool(candidate_result.get("passAfterSeamRing"))
            if page_style_class == "light_complex_diagram"
            else False,
            "passPreservingRollbackTriggered": bool(candidate_result.get("passPreservingRollbackTriggered"))
            if page_style_class == "light_complex_diagram"
            else False,
            "v4CandidateFrozen": bool(candidate_result.get("v4CandidateFrozen"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamMicroPolishAttempted": bool(candidate_result.get("seamMicroPolishAttempted"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamMicroPolishApplied": bool(candidate_result.get("seamMicroPolishApplied"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamMicroPolishAccepted": bool(candidate_result.get("seamMicroPolishAccepted"))
            if page_style_class == "light_complex_diagram"
            else False,
            "seamMicroPolishRejectedReason": str(candidate_result.get("seamMicroPolishRejectedReason") or "")
            if page_style_class == "light_complex_diagram"
            else "",
            "seamMicroPolishRingWidth": int(candidate_result.get("seamMicroPolishRingWidth") or 0)
            if page_style_class == "light_complex_diagram"
            else 0,
            "seamMicroPolishAlphaDelta": float(candidate_result.get("seamMicroPolishAlphaDelta") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishReferenceMode": str(candidate_result.get("seamMicroPolishReferenceMode") or "")
            if page_style_class == "light_complex_diagram"
            else "",
            "seamMicroPolishResidualBefore": float(candidate_result.get("seamMicroPolishResidualBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishResidualAfter": float(candidate_result.get("seamMicroPolishResidualAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishTextureBefore": float(candidate_result.get("seamMicroPolishTextureBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishTextureAfter": float(candidate_result.get("seamMicroPolishTextureAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishSeamBefore": float(candidate_result.get("seamMicroPolishSeamBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishSeamAfter": float(candidate_result.get("seamMicroPolishSeamAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishBrightnessBefore": float(candidate_result.get("seamMicroPolishBrightnessBefore") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "seamMicroPolishBrightnessAfter": float(candidate_result.get("seamMicroPolishBrightnessAfter") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "passBeforeV6": bool(candidate_result.get("passBeforeV6"))
            if page_style_class == "light_complex_diagram"
            else False,
            "passAfterV6": bool(candidate_result.get("passAfterV6"))
            if page_style_class == "light_complex_diagram"
            else False,
            "v5PassedBecameFailedCount": int(candidate_result.get("v5PassedBecameFailedCount") or 0)
            if page_style_class == "light_complex_diagram"
            else 0,
            "v6RollbackTriggered": bool(candidate_result.get("v6RollbackTriggered"))
            if page_style_class == "light_complex_diagram"
            else False,
            "textureSurgeAbortTriggered": bool(candidate_result.get("textureSurgeAbortTriggered"))
            if page_style_class == "light_complex_diagram"
            else False,
            "abortedCandidateName": str(candidate_result.get("abortedCandidateName") or "")
            if page_style_class == "light_complex_diagram"
            else "",
            "textureDeltaIncrease": float(candidate_result.get("textureDeltaIncrease") or 0.0)
            if page_style_class == "light_complex_diagram"
            else 0.0,
            "fallbackCandidateName": str(candidate_result.get("fallbackCandidateName") or "")
            if page_style_class == "light_complex_diagram"
            else "",
            "lightComplexCandidates": light_complex_candidates if page_style_class == "light_complex_diagram" else [],
            "wasClamped": detection["wasClamped"],
            "wasShrunk": detection["wasShrunk"],
            "skipReason": None if success else "failed_visual_verification",
            "analyzeOverlayPath": str(analyze_overlay_path),
            "processOverlayPath": str(process_overlay_path),
            "debugArtifacts": debug_artifacts,
            "repairMethod": method,
            "reason": "repaired" if success else "failed_visual_verification",
            "note": "NotebookLM template-constrained union-mask cleanup applied and visually verified."
            if success
            else "Repair was applied but the final output still failed removal or damage-control verification.",
        },
        output,
    )


def build_roi_candidates(width: int, height: int, config: dict[str, Any]) -> list[Box]:
    roi_w = min(int(width * float(config["roiWidthRatio"])), int(width * (SEARCH_X_MAX - SEARCH_X_MIN)))
    roi_h = min(int(height * float(config["roiHeightRatio"])), int(height * (SEARCH_Y_MAX - SEARCH_Y_MIN)))
    x = int(width * SEARCH_X_MAX) - roi_w
    y = int(height * SEARCH_Y_MAX) - roi_h
    return [
        Box(
            x=max(int(width * SEARCH_X_MIN), x),
            y=max(int(height * SEARCH_Y_MIN), y),
            width=roi_w,
            height=roi_h,
        )
    ]


def detect_watermark_box(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    roi: Box,
    *,
    page_theme: str,
    dominant_template: TemplateLock | None,
) -> dict[str, Any] | None:
    fallback_chain: list[str] = []
    foreground_points, threshold, polarity = collect_anchor_foreground_points(
        pixels, width, channel, roi, page_theme
    )
    min_pixels = max(12, int(roi.width * roi.height * 0.0015))
    if len(foreground_points) < min_pixels:
        return None

    min_x = min(point[0] for point in foreground_points)
    max_x = max(point[0] for point in foreground_points)
    min_y = min(point[1] for point in foreground_points)
    max_y = max(point[1] for point in foreground_points)

    raw_box = Box(
        x=max(0, min_x - 3),
        y=max(0, min_y - 2),
        width=min(width - max(0, min_x - 3), (max_x - min_x) + 7),
        height=min(height - max(0, min_y - 2), (max_y - min_y) + 5),
    )
    if raw_box.width <= 3 or raw_box.height <= 3:
        return None

    template_box, template_score = refine_with_notebooklm_template(
        foreground_points,
        raw_box,
        width,
        height,
        dominant_template,
    )
    if dominant_template is not None:
        template_box = lock_box_to_dominant_template(template_box, dominant_template, width, height)
        fallback_chain.append("document_template_lock")
    clamped_box, was_clamped, was_shrunk = clamp_to_notebooklm_template(template_box, width, height)
    if template_box != raw_box:
        was_clamped = True
    if not is_near_standard_anchor(clamped_box, width, height):
        clamped_box = fallback_template_box(width, height)
        was_clamped = True
        was_shrunk = True

    if looks_like_multiline_content(foreground_points, raw_box):
        clamped_box = fallback_template_box(width, height)
        was_clamped = True
        was_shrunk = True

    box_area_ratio = (clamped_box.width * clamped_box.height) / max(1, width * height)
    if box_area_ratio > MAX_REPAIR_AREA_RATIO:
        clamped_box = shrink_box_to_area_limit(clamped_box, width, height)
        was_shrunk = True

    glyph_mask = build_glyph_driven_mask_points(
        pixels, width, height, channel, clamped_box, threshold, polarity
    )
    mask_points = glyph_mask["points"]
    glyph_box = glyph_mask["glyphBox"]
    logo_box = glyph_mask["logoBox"]
    fringe_box = glyph_mask["fringeBox"]
    conservative_box = build_conservative_template_box(clamped_box, width, height, dominant_template)
    conservative_mask_points = box_to_points(conservative_box)
    glyph_is_abnormally_small = glyph_box is None or (
        glyph_box.height < max(6, int(clamped_box.height * 0.5))
        or glyph_box.width < max(10, int(clamped_box.width * 0.45))
    )
    if glyph_is_abnormally_small:
        fallback_chain.append("glyph_too_small_template_fallback")

    if not mask_points or glyph_is_abnormally_small:
        mask_generation_mode = "template_union"
    else:
        mask_generation_mode = "union_mask"

    expanded_mask_box, mask_points = build_union_mask_points(
        width,
        height,
        detected_box=clamped_box,
        conservative_box=conservative_box,
        glyph_points=mask_points,
        glyph_box=glyph_box,
        logo_box=logo_box,
        fringe_box=fringe_box,
        force_conservative=glyph_is_abnormally_small,
    )
    if len(mask_points) < min_pixels:
        return None
    mask_box = points_to_box(mask_points)
    template_id = dominant_template.template_id if dominant_template else nearest_template(clamped_box.width, clamped_box.height)[0]
    mask_box = ensure_min_box_ratio(mask_box, clamped_box, width, height, MIN_FINAL_MASK_RATIO)
    mask_points = box_to_points(mask_box)
    rerun_count = 0
    shrink_strategy = "fallback" if glyph_is_abnormally_small else "mask_bbox"
    repair_area_ratio = round(len(mask_points) / max(1, width * height), 6)
    if repair_area_ratio > MAX_REPAIR_AREA_RATIO:
        return None
    baseline_metrics = measure_watermark_presence(pixels, width, height, channel, mask_box, polarity, threshold)
    mask_area_ratio_within_template = round(len(mask_points) / max(1, clamped_box.width * clamped_box.height), 6)
    mask_height_ratio_within_template = round(mask_box.height / max(1, clamped_box.height), 6)

    return {
        "roi": roi,
        "rawBox": raw_box,
        "box": clamped_box,
        "normalizedBox": normalize_render_box(clamped_box, width, height),
        "expandedMaskBox": expanded_mask_box,
        "maskBox": mask_box,
        "maskPoints": mask_points,
        "glyphBox": glyph_box,
        "logoBox": logo_box,
        "fringeBox": fringe_box,
        "conservativeTemplateBox": conservative_box,
        "maskGenerationMode": mask_generation_mode,
        "repairAreaRatio": repair_area_ratio,
        "maskAreaRatioWithinTemplate": mask_area_ratio_within_template,
        "maskHeightRatioWithinTemplate": mask_height_ratio_within_template,
        "templateId": template_id,
        "marginRight": max(0, width - clamped_box.x - clamped_box.width),
        "marginBottom": max(0, height - clamped_box.y - clamped_box.height),
        "templateScore": round(template_score, 4),
        "rerunCount": rerun_count,
        "fallbackChain": fallback_chain,
        "shrinkStrategy": shrink_strategy,
        "threshold": threshold,
        "polarity": polarity,
        "baselineResidualScore": baseline_metrics["residualWatermarkScore"],
        "baselineTemplateSimilarity": baseline_metrics["templateSimilarityScore"],
        "wasClamped": was_clamped,
        "wasShrunk": was_shrunk,
    }


def style_repair_policy(page_style_class: str) -> str:
    mapping = {
        "dark_plain": "dark_plain_repair_baseline_v1",
        "dark_glow_panel": "dark_glow_panel_repair_baseline_v1",
        "light_plain": "light_plain_repair_v1",
        "light_gridline": "light_gridline_repair_v1",
        "light_gradient": "light_gradient_repair_v1",
        "light_complex_diagram": "light_complex_diagram_repair_v1",
        "mixed_structure": "mixed_structure_repair_v1",
    }
    return mapping.get(page_style_class, "mixed_structure_repair_v1")


def build_light_complex_mask_profiles(
    detection: dict[str, Any], width: int, height: int
) -> list[tuple[str, Box, set[tuple[int, int]]]]:
    base_box = detection["maskBox"]
    source_points = set(detection["maskPoints"])
    conservative_box = detection.get("logoBox") or detection.get("glyphBox") or base_box
    medium_box = base_box
    aggressive_box = expand_box_for_second_pass(base_box, width, height)
    profiles: list[tuple[str, Box, set[tuple[int, int]]]] = []
    for profile_id, profile_box in (
        ("candidate_a_conservative", conservative_box),
        ("candidate_b_medium", medium_box),
        ("candidate_c_aggressive", aggressive_box),
    ):
        if not isinstance(profile_box, Box):
            profile_box = base_box
        profile_points = {
            point
            for point in source_points
            if profile_box.x <= point[0] < profile_box.x + profile_box.width
            and profile_box.y <= point[1] < profile_box.y + profile_box.height
        }
        if not profile_points:
            profile_points = box_to_points(profile_box)
        profiles.append((profile_id, profile_box, profile_points))
    return profiles


def detect_structure_protected_points(
    pixels: bytes,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
) -> set[tuple[int, int]]:
    protected: set[tuple[int, int]] = set()
    segments = detect_structure_lines(pixels, width, height, channel, mask_box, prefer_dark=True)
    for segment in segments:
        if segment["orientation"] == 0:
            yy = segment["position"]
            for xx in range(mask_box.x, min(width, mask_box.x + mask_box.width)):
                for offset in (-1, 0, 1):
                    ny = yy + offset
                    if mask_box.y <= ny < mask_box.y + mask_box.height:
                        protected.add((xx, ny))
        else:
            xx = segment["position"]
            for yy in range(mask_box.y, min(height, mask_box.y + mask_box.height)):
                for offset in (-1, 0, 1):
                    nx = xx + offset
                    if mask_box.x <= nx < mask_box.x + mask_box.width:
                        protected.add((nx, yy))
    return protected


def measure_structure_preservation(
    original_pixels: bytes,
    repaired_pixels: bytes,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
) -> float:
    before = detect_structure_lines(original_pixels, width, height, channel, mask_box, prefer_dark=True)
    after = detect_structure_lines(repaired_pixels, width, height, channel, mask_box, prefer_dark=True)
    if not before:
        return 0.0
    before_set = {(segment["orientation"], segment["position"] // 2) for segment in before}
    after_set = {(segment["orientation"], segment["position"] // 2) for segment in after}
    overlap = len(before_set & after_set)
    return round(1.0 - overlap / max(1, len(before_set)), 6)


def default_trailing_cleanup_diagnostics() -> dict[str, Any]:
    return {
        "trailingFeatherRadius": 0,
        "trailingBrightnessMatched": False,
        "trailingBrightnessBefore": 0.0,
        "trailingBrightnessAfter": 0.0,
        "trailingSeamBefore": 0.0,
        "trailingSeamAfter": 0.0,
        "structureProtectionTriggered": False,
    }


def default_seam_ring_diagnostics() -> dict[str, Any]:
    return {
        "seamRingApplied": False,
        "seamRingWidth": 0,
        "seamRingAccepted": False,
        "seamRingRejectedReason": "",
        "seamRingStructureDense": False,
        "seamRingResidualBefore": 0.0,
        "seamRingResidualAfter": 0.0,
        "seamRingTextureBefore": 0.0,
        "seamRingTextureAfter": 0.0,
        "seamRingSeamBefore": 0.0,
        "seamRingSeamAfter": 0.0,
        "seamRingBrightnessBefore": 0.0,
        "seamRingBrightnessAfter": 0.0,
        "passBeforeSeamRing": False,
        "passAfterSeamRing": False,
        "passPreservingRollbackTriggered": False,
        "v4CandidateFrozen": False,
        "seamRingPoints": set(),
    }


def default_seam_micro_polish_diagnostics() -> dict[str, Any]:
    return {
        "seamMicroPolishAttempted": False,
        "seamMicroPolishApplied": False,
        "seamMicroPolishAccepted": False,
        "seamMicroPolishRejectedReason": "",
        "seamMicroPolishRingWidth": 0,
        "seamMicroPolishAlphaDelta": 0.0,
        "seamMicroPolishReferenceMode": "",
        "seamMicroPolishResidualBefore": 0.0,
        "seamMicroPolishResidualAfter": 0.0,
        "seamMicroPolishTextureBefore": 0.0,
        "seamMicroPolishTextureAfter": 0.0,
        "seamMicroPolishSeamBefore": 0.0,
        "seamMicroPolishSeamAfter": 0.0,
        "seamMicroPolishBrightnessBefore": 0.0,
        "seamMicroPolishBrightnessAfter": 0.0,
        "passBeforeV6": False,
        "passAfterV6": False,
        "v5PassedBecameFailedCount": 0,
        "v6RollbackTriggered": False,
        "seamMicroPolishPoints": set(),
    }


def median_rgb(samples: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    if not samples:
        return (0, 0, 0)
    r = sorted(color[0] for color in samples)
    g = sorted(color[1] for color in samples)
    b = sorted(color[2] for color in samples)
    m = len(samples) // 2
    return (r[m], g[m], b[m])


def clipped_mean_rgb(
    samples: list[tuple[int, int, int]], *, low_pct: float = 0.1, high_pct: float = 0.1
) -> tuple[int, int, int]:
    if not samples:
        return (0, 0, 0)
    luma = [to_gray(*c) for c in samples]
    order = sorted(range(len(samples)), key=lambda i: luma[i])
    lo = int(len(order) * low_pct)
    hi = int(len(order) * (1.0 - high_pct))
    if hi <= lo:
        return average_rgb(samples)
    keep = [samples[i] for i in order[lo:hi]]
    return average_rgb(keep)


def collect_ring_neighbor_samples(
    pixels: bytearray, width: int, height: int, channel: int, x: int, y: int, mask_points: set[tuple[int, int]]
) -> list[tuple[int, int, int]]:
    out: list[tuple[int, int, int]] = []
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            nx = min(width - 1, max(0, x + dx))
            ny = min(height - 1, max(0, y + dy))
            if (nx, ny) in mask_points:
                continue
            out.append(read_rgb(pixels, width, channel, nx, ny))
    return out


def sample_background_ring_color_median(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    x: int,
    y: int,
    mask_points: set[tuple[int, int]],
) -> tuple[int, int, int]:
    s = collect_ring_neighbor_samples(pixels, width, height, channel, x, y, mask_points)
    if not s:
        return read_rgb(pixels, width, channel, x, y)
    return median_rgb(s)


def sample_background_ring_color_clipped(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    x: int,
    y: int,
    mask_points: set[tuple[int, int]],
) -> tuple[int, int, int]:
    s = collect_ring_neighbor_samples(pixels, width, height, channel, x, y, mask_points)
    if not s:
        return read_rgb(pixels, width, channel, x, y)
    return clipped_mean_rgb(s)


def apply_seam_micro_polish(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    mask_points: set[tuple[int, int]],
    micro_ring_points: set[tuple[int, int]],
    protected_points: set[tuple[int, int]],
    reference_mode: str,
    base_strength: float,
    alpha_ramp: float,
) -> None:
    t = min(0.1, max(0.0, base_strength * alpha_ramp))
    if reference_mode == "median":
        ref_fn = sample_background_ring_color_median
    else:
        ref_fn = sample_background_ring_color_clipped
    for xx, yy in micro_ring_points:
        if (xx, yy) in protected_points:
            continue
        repaired = read_rgb(pixels, width, channel, xx, yy)
        reference = ref_fn(pixels, width, height, channel, xx, yy, mask_points)
        mixed = blend_rgb(repaired, reference, t)
        write_rgb(pixels, width, channel, xx, yy, mixed)


def dry_run_v6_accepts(
    ver_after: dict[str, Any],
    v5: dict[str, Any],
    pass_before: bool,
    structure_dense: bool,
) -> str:
    p_after = bool(ver_after.get("passed"))
    if p_after != pass_before:
        return "pass_state_mismatch"
    r5 = float(v5.get("residualWatermarkScore", 0.0))
    t5 = float(v5.get("damageTextureDelta", 0.0))
    b5 = float(v5.get("brightnessDelta", 0.0))
    s5 = float(v5.get("damageSeamScore", 0.0))
    ra = float(ver_after.get("residualWatermarkScore", 0.0))
    ta = float(ver_after.get("damageTextureDelta", 0.0))
    ba = float(ver_after.get("brightnessDelta", 0.0))
    sa = float(ver_after.get("damageSeamScore", 0.0))
    if sa >= s5 - 1e-7:
        return "seam_not_improved"
    seam_drop = s5 - sa
    if structure_dense and seam_drop < SEAM_MICRO_DENSE_SIGNIFICANT_DROP:
        return "dense_gain_not_significant"
    if ra > r5 + SEAM_MICRO_RESIDUAL_MAX_DELTA + 1e-9:
        return "residual_regressed"
    if ta > t5 + SEAM_MICRO_TEXTURE_MAX_DELTA + 1e-9:
        return "texture_regressed"
    if ba > b5 + SEAM_MICRO_BRIGHTNESS_MAX_DELTA + 1e-9:
        return "brightness_regressed"
    if not pass_before and (ra > r5 + 1e-9 or ta > t5 + 1e-9 or ba > b5 + 1e-9):
        return "failed_page_metric_rebound"
    if pass_before and (s5 - sa) < SEAM_MICRO_MIN_SEAM_DROP_PASSED:
        if ra > r5 + 1e-6 or ba > b5 + 1e-6 or ta > t5 + 1e-6:
            return "minor_seam_gain_with_metric_regress"
    return ""


def build_seam_micro_ring_points_from_v5_ring(
    mask_points: set[tuple[int, int]],
    mask_box: Box,
    seam_ring_points: set[tuple[int, int]],
    seam_ring_width: int,
) -> set[tuple[int, int]]:
    if not seam_ring_points:
        return set()
    if seam_ring_width <= 1:
        return {point for point in seam_ring_points if point in mask_points}
    target_edge_distance = max(1, seam_ring_width - 1)
    micro_ring: set[tuple[int, int]] = set()
    for xx, yy in seam_ring_points:
        if (xx, yy) not in mask_points:
            continue
        edge_distance = min(
            xx - mask_box.x,
            mask_box.x + mask_box.width - 1 - xx,
            yy - mask_box.y,
            mask_box.y + mask_box.height - 1 - yy,
        )
        if edge_distance == target_edge_distance:
            micro_ring.add((xx, yy))
    return micro_ring


def try_apply_seam_micro_polish(
    original_pixels: bytes,
    candidate_pixels: bytes,
    width: int,
    height: int,
    channel: int,
    verification_v5: dict[str, Any],
    profile_box: Box,
    trailing_mask_box: Box | None,
    polarity: str,
    threshold: int,
    baseline_score: float | None,
    protected_points: set[tuple[int, int]],
    method: str | None,
    structure_break_score: float,
    seam_ring_diagnostics: dict[str, Any],
) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    d = default_seam_micro_polish_diagnostics()
    d["v5PassedBecameFailedCount"] = 0
    d["v6RollbackTriggered"] = False
    v5 = verification_v5
    s5 = float(v5.get("damageSeamScore", 0.0))
    seam_after_ring = float(seam_ring_diagnostics.get("seamRingSeamAfter") or s5)
    if not bool(seam_ring_diagnostics.get("seamRingAccepted")):
        d["seamMicroPolishRejectedReason"] = "seam_ring_not_accepted"
        return candidate_pixels, v5, d
    rj = str(seam_ring_diagnostics.get("seamRingRejectedReason") or "")
    if rj in ("residual_regressed", "texture_regressed", "pass_preserving_failed"):
        d["seamMicroPolishRejectedReason"] = f"v5_reject_reason_excluded:{rj}"
        return candidate_pixels, v5, d
    if seam_after_ring <= SEAM_MICRO_TARGET_SEAM:
        d["seamMicroPolishRejectedReason"] = "seam_near_target"
        return candidate_pixels, v5, d
    if s5 < SEAM_MICRO_SEAM_ALREADY_LOW:
        d["seamMicroPolishRejectedReason"] = "seam_already_low"
        return candidate_pixels, v5, d
    structure_dense = bool(seam_ring_diagnostics.get("seamRingStructureDense"))
    d["seamMicroPolishSeamBefore"] = s5
    d["seamMicroPolishResidualBefore"] = float(v5.get("residualWatermarkScore", 0.0))
    d["seamMicroPolishTextureBefore"] = float(v5.get("damageTextureDelta", 0.0))
    d["seamMicroPolishBrightnessBefore"] = float(v5.get("brightnessDelta", 0.0))
    d["passBeforeV6"] = bool(v5.get("passed"))
    seam_target_box = trailing_mask_box if trailing_mask_box is not None else profile_box
    mask_points = box_to_points(seam_target_box)
    seam_ring_points = set(seam_ring_diagnostics.get("seamRingPoints") or set())
    seam_ring_width = int(seam_ring_diagnostics.get("seamRingWidth") or 0)
    micro_ring = build_seam_micro_ring_points_from_v5_ring(mask_points, seam_target_box, seam_ring_points, seam_ring_width)
    micro_ring = {point for point in micro_ring if point not in protected_points}
    d["seamMicroPolishAttempted"] = True
    d["seamMicroPolishRingWidth"] = 1
    d["seamMicroPolishApplied"] = True
    if not micro_ring:
        d["seamMicroPolishApplied"] = False
        d["seamMicroPolishRejectedReason"] = "empty_micro_ring"
        return candidate_pixels, v5, d
    d["seamMicroPolishPoints"] = micro_ring
    pass_b = d["passBeforeV6"]
    for ref_mode in ("median", "clipped_mean"):
        for alpha_ramp in (1.05, 1.08, 1.1, 0.95, 0.9):
            dry = bytearray(candidate_pixels)
            apply_seam_micro_polish(
                dry,
                width,
                height,
                channel,
                mask_points,
                micro_ring,
                protected_points,
                ref_mode,
                SEAM_MICRO_STRENGTH,
                alpha_ramp,
            )
            ver_after = verify_residual_watermark(
                original_pixels,
                bytes(dry),
                width,
                height,
                channel,
                profile_box,
                profile_box,
                polarity,
                threshold,
                baseline_score,
            )
            apply_light_complex_verification_thresholds(ver_after, method, structure_break_score)
            reason = dry_run_v6_accepts(ver_after, v5, pass_b, structure_dense)
            if not reason:
                d["seamMicroPolishAccepted"] = True
                d["seamMicroPolishReferenceMode"] = ref_mode
                d["seamMicroPolishAlphaDelta"] = round(float(alpha_ramp) - 1.0, 4)
                d["seamMicroPolishSeamAfter"] = float(ver_after.get("damageSeamScore", 0.0))
                d["seamMicroPolishResidualAfter"] = float(ver_after.get("residualWatermarkScore", 0.0))
                d["seamMicroPolishTextureAfter"] = float(ver_after.get("damageTextureDelta", 0.0))
                d["seamMicroPolishBrightnessAfter"] = float(ver_after.get("brightnessDelta", 0.0))
                d["passAfterV6"] = bool(ver_after.get("passed"))
                d["v6RollbackTriggered"] = False
                return bytes(dry), ver_after, d
    d["seamMicroPolishAccepted"] = False
    d["seamMicroPolishRejectedReason"] = "structure_dense_no_significant_gain" if structure_dense else "dry_run_no_acceptable"
    d["seamMicroPolishSeamAfter"] = s5
    d["seamMicroPolishResidualAfter"] = d["seamMicroPolishResidualBefore"]
    d["seamMicroPolishTextureAfter"] = d["seamMicroPolishTextureBefore"]
    d["seamMicroPolishBrightnessAfter"] = d["seamMicroPolishBrightnessBefore"]
    d["passAfterV6"] = d["passBeforeV6"]
    d["v6RollbackTriggered"] = True
    return candidate_pixels, v5, d


def estimate_structure_density(
    pixels: bytes,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
    protected_points: set[tuple[int, int]],
) -> float:
    context_box = expand_box_asymmetric_anchor(mask_box, width, height, left=6, top=6, right=6, bottom=6)
    area = max(1, context_box.width * context_box.height)
    protected_hits = sum(
        1
        for yy in range(context_box.y, min(height, context_box.y + context_box.height))
        for xx in range(context_box.x, min(width, context_box.x + context_box.width))
        if (xx, yy) in protected_points
    )
    edge_hits = 0
    sampled = 0
    for yy in range(context_box.y + 1, min(height - 1, context_box.y + context_box.height - 1)):
        for xx in range(context_box.x + 1, min(width - 1, context_box.x + context_box.width - 1)):
            center = to_gray(*read_rgb(pixels, width, channel, xx, yy))
            horizontal = abs(center - to_gray(*read_rgb(pixels, width, channel, xx - 1, yy))) + abs(
                center - to_gray(*read_rgb(pixels, width, channel, xx + 1, yy))
            )
            vertical = abs(center - to_gray(*read_rgb(pixels, width, channel, xx, yy - 1))) + abs(
                center - to_gray(*read_rgb(pixels, width, channel, xx, yy + 1))
            )
            if max(horizontal, vertical) >= 52:
                edge_hits += 1
            sampled += 1
    return round((protected_hits / area) * 0.65 + (edge_hits / max(1, sampled)) * 0.35, 6)


def adaptive_trailing_feather_radius(mask_box: Box, structure_dense: bool) -> int:
    if structure_dense:
        return 0
    shortest = min(mask_box.width, mask_box.height)
    if shortest < 4:
        return 0
    radius = max(1, min(3, shortest // 7))
    if structure_dense:
        radius = max(1, radius - 1)
    return radius


def feathered_trailing_mask_points(
    mask_points: set[tuple[int, int]],
    mask_box: Box,
    radius: int,
) -> dict[tuple[int, int], float]:
    if radius <= 0:
        return {point: 1.0 for point in mask_points}
    alpha_by_point: dict[tuple[int, int], float] = {}
    edge_points = find_edge_points(mask_points)
    for point in mask_points:
        if point in edge_points:
            alpha_by_point[point] = 0.86
            continue
        x, y = point
        box_edge_distance = min(
            x - mask_box.x,
            mask_box.x + mask_box.width - 1 - x,
            y - mask_box.y,
            mask_box.y + mask_box.height - 1 - y,
        )
        alpha_by_point[point] = min(1.0, max(0.9, 0.86 + box_edge_distance / max(1, radius) * 0.12))
    return alpha_by_point


def apply_feathered_composite(
    base_pixels: bytes,
    repaired_pixels: bytearray,
    width: int,
    channel: int,
    alpha_by_point: dict[tuple[int, int], float],
    *,
    strength: float,
) -> None:
    for xx, yy in alpha_by_point:
        base = read_rgb(base_pixels, width, channel, xx, yy)
        repaired = read_rgb(repaired_pixels, width, channel, xx, yy)
        mixed = blend_rgb(base, repaired, min(1.0, max(0.0, alpha_by_point[(xx, yy)] * strength)))
        write_rgb(repaired_pixels, width, channel, xx, yy, mixed)


def match_trailing_brightness(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> tuple[bool, float, float]:
    before = measure_repair_damage(pixels, width, height, channel, mask_box, mask_box)["damageLumaDelta"]
    if before <= TRAILING_BRIGHTNESS_MATCH_TRIGGER:
        return False, before, before
    inner_samples = [read_rgb(pixels, width, channel, xx, yy) for xx, yy in mask_points]
    ring_points = [
        (xx, yy)
        for yy in range(max(0, mask_box.y - 3), min(height, mask_box.y + mask_box.height + 3))
        for xx in range(max(0, mask_box.x - 3), min(width, mask_box.x + mask_box.width + 3))
        if (xx, yy) not in mask_points
        and not (mask_box.x <= xx < mask_box.x + mask_box.width and mask_box.y <= yy < mask_box.y + mask_box.height)
    ]
    ring_samples = [read_rgb(pixels, width, channel, xx, yy) for xx, yy in ring_points]
    if not inner_samples or not ring_samples:
        return False, before, before
    inner_mean = average_rgb(inner_samples)
    ring_mean = average_rgb(ring_samples)
    adjustment = tuple(
        int(max(-18, min(18, (ring_mean[idx] - inner_mean[idx]) * 0.62))) for idx in range(3)
    )
    for xx, yy in mask_points:
        rgb = read_rgb(pixels, width, channel, xx, yy)
        write_rgb(
            pixels,
            width,
            channel,
            xx,
            yy,
            (
                max(0, min(255, rgb[0] + adjustment[0])),
                max(0, min(255, rgb[1] + adjustment[1])),
                max(0, min(255, rgb[2] + adjustment[2])),
            ),
        )
    after = measure_repair_damage(pixels, width, height, channel, mask_box, mask_box)["damageLumaDelta"]
    return after < before, before, after


def seam_ring_width_for_box(mask_box: Box, structure_dense: bool) -> int:
    shortest = min(mask_box.width, mask_box.height)
    if shortest < 3:
        return 0
    width = max(1, min(2, int(shortest * 0.06)))
    return 1 if structure_dense else width


def build_inner_seam_ring_points(
    mask_points: set[tuple[int, int]],
    mask_box: Box,
    width_px: int,
) -> set[tuple[int, int]]:
    if width_px <= 0:
        return set()
    ring_points: set[tuple[int, int]] = set()
    for xx, yy in mask_points:
        edge_distance = min(
            xx - mask_box.x,
            mask_box.x + mask_box.width - 1 - xx,
            yy - mask_box.y,
            mask_box.y + mask_box.height - 1 - yy,
        )
        if edge_distance < width_px:
            ring_points.add((xx, yy))
    return ring_points


def apply_seam_ring_harmonization(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    mask_points: set[tuple[int, int]],
    seam_ring_points: set[tuple[int, int]],
    *,
    strength: float,
) -> None:
    for xx, yy in seam_ring_points:
        repaired = read_rgb(pixels, width, channel, xx, yy)
        reference = sample_background_ring_color(pixels, width, height, channel, xx, yy, mask_points)
        mixed = blend_rgb(repaired, reference, strength)
        write_rgb(pixels, width, channel, xx, yy, mixed)


def apply_light_complex_verification_thresholds(
    verification: dict[str, Any],
    method: str | None,
    structure_break_score: float,
) -> None:
    verification["passed"] = bool(
        method is not None
        and verification["residualWatermarkScore"] <= LIGHT_COMPLEX_RESIDUAL_PASS
        and verification["damageTextureDelta"] <= LIGHT_COMPLEX_DAMAGE_TEXTURE_PASS
        and verification["damageSeamScore"] <= LIGHT_COMPLEX_SEAM_PASS
        and verification["brightnessDelta"] <= LIGHT_COMPLEX_BRIGHTNESS_PASS
        and structure_break_score <= LIGHT_COMPLEX_STRUCTURE_BREAK_PASS
    )
    verification["removalPassPassed"] = bool(
        method is not None
        and verification["residualWatermarkScore"] <= LIGHT_COMPLEX_RESIDUAL_PASS
    )
    verification["damageControlPassPassed"] = bool(
        method is not None
        and verification["damageTextureDelta"] <= LIGHT_COMPLEX_DAMAGE_TEXTURE_PASS
        and verification["damageSeamScore"] <= LIGHT_COMPLEX_SEAM_PASS
        and verification["brightnessDelta"] <= LIGHT_COMPLEX_BRIGHTNESS_PASS
        and structure_break_score <= LIGHT_COMPLEX_STRUCTURE_BREAK_PASS
    )
    verification["structureBreakScore"] = structure_break_score


def try_apply_seam_ring_harmonization(
    original_pixels: bytes,
    candidate_pixels: bytes,
    width: int,
    height: int,
    channel: int,
    verification_before: dict[str, Any],
    profile_box: Box,
    trailing_mask_box: Box | None,
    polarity: str,
    threshold: int,
    baseline_score: float | None,
    protected_points: set[tuple[int, int]],
    method: str | None,
    structure_break_score: float,
) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    diagnostics = default_seam_ring_diagnostics()
    diagnostics["v4CandidateFrozen"] = True
    diagnostics["passBeforeSeamRing"] = bool(verification_before.get("passed"))
    diagnostics["seamRingResidualBefore"] = float(verification_before.get("residualWatermarkScore", 0.0))
    diagnostics["seamRingTextureBefore"] = float(verification_before.get("damageTextureDelta", 0.0))
    diagnostics["seamRingSeamBefore"] = float(verification_before.get("damageSeamScore", 0.0))
    diagnostics["seamRingBrightnessBefore"] = float(verification_before.get("brightnessDelta", 0.0))
    seam_target_box = trailing_mask_box if trailing_mask_box is not None else profile_box
    trailing_mask_points = box_to_points(seam_target_box)
    structure_density = estimate_structure_density(original_pixels, width, height, channel, seam_target_box, protected_points)
    structure_dense = structure_density >= 0.055
    diagnostics["seamRingStructureDense"] = structure_dense
    ring_width = seam_ring_width_for_box(seam_target_box, structure_dense)
    diagnostics["seamRingWidth"] = ring_width
    seam_ring_points = build_inner_seam_ring_points(trailing_mask_points, seam_target_box, ring_width)
    seam_ring_points = {point for point in seam_ring_points if point not in protected_points}
    diagnostics["seamRingPoints"] = seam_ring_points
    if not seam_ring_points:
        diagnostics["seamRingRejectedReason"] = "empty_seam_ring"
        diagnostics["passAfterSeamRing"] = diagnostics["passBeforeSeamRing"]
        return candidate_pixels, verification_before, diagnostics
    dry_run = bytearray(candidate_pixels)
    apply_seam_ring_harmonization(
        dry_run,
        width,
        height,
        channel,
        trailing_mask_points,
        seam_ring_points,
        strength=0.24 if structure_dense else 0.46,
    )
    verification_after = verify_residual_watermark(
        original_pixels,
        bytes(dry_run),
        width,
        height,
        channel,
        profile_box,
        profile_box,
        polarity,
        threshold,
        baseline_score,
    )
    apply_light_complex_verification_thresholds(verification_after, method, structure_break_score)
    diagnostics["seamRingApplied"] = True
    diagnostics["passAfterSeamRing"] = bool(verification_after.get("passed"))
    diagnostics["seamRingResidualAfter"] = float(verification_after.get("residualWatermarkScore", 0.0))
    diagnostics["seamRingTextureAfter"] = float(verification_after.get("damageTextureDelta", 0.0))
    diagnostics["seamRingSeamAfter"] = float(verification_after.get("damageSeamScore", 0.0))
    diagnostics["seamRingBrightnessAfter"] = float(verification_after.get("brightnessDelta", 0.0))
    reject_reason = ""
    if bool(verification_before.get("passed")) and not bool(verification_after.get("passed")):
        reject_reason = "pass_preserving_failed"
    elif diagnostics["seamRingResidualAfter"] > diagnostics["seamRingResidualBefore"] + SEAM_RING_RESIDUAL_EPSILON:
        reject_reason = "residual_regressed"
    elif diagnostics["seamRingTextureAfter"] > diagnostics["seamRingTextureBefore"] + SEAM_RING_TEXTURE_EPSILON:
        reject_reason = "texture_regressed"
    elif diagnostics["seamRingSeamAfter"] > diagnostics["seamRingSeamBefore"]:
        reject_reason = "seam_not_improved"
    elif diagnostics["seamRingBrightnessAfter"] > diagnostics["seamRingBrightnessBefore"] + SEAM_RING_BRIGHTNESS_EPSILON:
        reject_reason = "brightness_regressed"
    if reject_reason:
        diagnostics["seamRingRejectedReason"] = reject_reason
        diagnostics["passPreservingRollbackTriggered"] = reject_reason == "pass_preserving_failed"
        return candidate_pixels, verification_before, diagnostics
    diagnostics["seamRingAccepted"] = True
    return bytes(dry_run), verification_after, diagnostics


def find_residual_hotspot_box(
    repaired_pixels: bytes,
    width: int,
    height: int,
    channel: int,
    search_box: Box,
    polarity: str,
    threshold: int,
    protected_points: set[tuple[int, int]],
) -> Box | None:
    hotspot_points: set[tuple[int, int]] = set()
    for yy in range(search_box.y, min(height, search_box.y + search_box.height)):
        for xx in range(search_box.x, min(width, search_box.x + search_box.width)):
            if (xx, yy) in protected_points:
                continue
            gray = to_gray(*read_rgb(repaired_pixels, width, channel, xx, yy))
            watermark_like = (polarity == "dark" and gray <= threshold) or (polarity == "light" and gray >= threshold)
            if watermark_like and notebooklm_template_weight(xx, yy, search_box) >= 0.25:
                hotspot_points.add((xx, yy))
    if len(hotspot_points) < 10:
        return None
    hotspot_box = points_to_box(hotspot_points)
    return expand_box_asymmetric_anchor(hotspot_box, width, height, left=2, top=2, right=3, bottom=3)


def apply_trailing_cleanup(
    original_pixels: bytes,
    repaired_pixels: bytes,
    width: int,
    height: int,
    channel: int,
    search_box: Box,
    polarity: str,
    threshold: int,
    protected_points: set[tuple[int, int]],
) -> tuple[bytes, Box | None, Box | None, bool, dict[str, Any]]:
    diagnostics = default_trailing_cleanup_diagnostics()
    hotspot_box = find_residual_hotspot_box(
        repaired_pixels,
        width,
        height,
        channel,
        search_box,
        polarity,
        threshold,
        protected_points,
    )
    if hotspot_box is None:
        return repaired_pixels, None, None, False, diagnostics
    structure_density = estimate_structure_density(original_pixels, width, height, channel, hotspot_box, protected_points)
    structure_dense = structure_density >= 0.055
    diagnostics["structureProtectionTriggered"] = structure_dense
    cleanup_points = {
        (xx, yy)
        for yy in range(hotspot_box.y, min(height, hotspot_box.y + hotspot_box.height))
        for xx in range(hotspot_box.x, min(width, hotspot_box.x + hotspot_box.width))
        if (xx, yy) not in protected_points
    }
    if not cleanup_points:
        return repaired_pixels, hotspot_box, None, False, diagnostics
    trailing_mask_points = dilate_points(cleanup_points, hotspot_box, radius=1)
    trailing_mask_points = {point for point in trailing_mask_points if point not in protected_points}
    if not trailing_mask_points:
        return repaired_pixels, hotspot_box, None, False, diagnostics
    trailing_mask_box = points_to_box(trailing_mask_points)
    diagnostics["trailingSeamBefore"] = measure_repair_damage(
        repaired_pixels, width, height, channel, trailing_mask_box, trailing_mask_box
    )["damageSeamScore"]
    fill_pixels = bytearray(repaired_pixels)
    apply_gradient_fill(fill_pixels, width, height, channel, trailing_mask_box, trailing_mask_points)
    feather_radius = adaptive_trailing_feather_radius(trailing_mask_box, structure_dense)
    diagnostics["trailingFeatherRadius"] = feather_radius
    alpha_by_point = feathered_trailing_mask_points(trailing_mask_points, trailing_mask_box, feather_radius)
    mutable = bytearray(repaired_pixels)
    apply_feathered_composite(
        repaired_pixels,
        fill_pixels,
        width,
        channel,
        alpha_by_point,
        strength=0.98 if structure_dense else 1.0,
    )
    mutable[:] = fill_pixels
    matched, brightness_before, brightness_after = match_trailing_brightness(
        mutable,
        width,
        height,
        channel,
        trailing_mask_box,
        trailing_mask_points,
    )
    diagnostics["trailingBrightnessMatched"] = matched
    diagnostics["trailingBrightnessBefore"] = round(brightness_before, 6)
    diagnostics["trailingBrightnessAfter"] = round(brightness_after, 6)
    blend_repair_edges(
        original_pixels,
        mutable,
        width,
        height,
        channel,
        trailing_mask_points,
        trailing_mask_box,
    )
    diagnostics["trailingSeamAfter"] = measure_repair_damage(
        mutable, width, height, channel, trailing_mask_box, trailing_mask_box
    )["damageSeamScore"]
    return bytes(mutable), hotspot_box, trailing_mask_box, True, diagnostics


def run_light_complex_diagram_repair_v1(
    source: bytes,
    *,
    width: int,
    height: int,
    channel: int,
    detection: dict[str, Any],
    page_theme: str,
    degraded_mode: bool,
    enable_seam_micro_polish: bool,
) -> dict[str, Any]:
    profiles = build_light_complex_mask_profiles(detection, width, height)
    candidates: list[dict[str, Any]] = []
    for profile_id, profile_box, profile_points in profiles:
        protected_points = detect_structure_protected_points(source, width, height, channel, profile_box)
        effective_points = {point for point in profile_points if point not in protected_points}
        if len(effective_points) < max(12, int(len(profile_points) * 0.2)):
            effective_points = set(profile_points)
        mutable = bytearray(source)
        method, fallback_chain = apply_repair(
            source,
            mutable,
            width,
            height,
            channel,
            profile_box,
            effective_points,
            profile_box,
            page_theme,
            degraded_mode,
            page_style_class="light_complex_diagram",
        )
        candidate_pixels = bytes(mutable)
        verification = (
            verify_residual_watermark(
                source,
                candidate_pixels,
                width,
                height,
                channel,
                profile_box,
                profile_box,
                detection["polarity"],
                detection["threshold"],
                detection["baselineResidualScore"],
            )
            if method is not None
            else default_failed_verification()
        )
        residual_hotspot_box = None
        trailing_cleanup_mask_box = None
        trailing_cleanup_applied = False
        trailing_cleanup_diagnostics = default_trailing_cleanup_diagnostics()
        if (
            method is not None
            and verification["residualWatermarkScore"] >= LIGHT_COMPLEX_TRAILING_RESIDUAL_TRIGGER
        ):
            verification_before_trailing = verification
            (
                cleaned_pixels,
                residual_hotspot_box,
                trailing_cleanup_mask_box,
                trailing_cleanup_applied,
                trailing_cleanup_diagnostics,
            ) = apply_trailing_cleanup(
                source,
                candidate_pixels,
                width,
                height,
                channel,
                profile_box,
                detection["polarity"],
                detection["threshold"],
                protected_points,
            )
            if trailing_cleanup_applied:
                candidate_pixels = cleaned_pixels
                verification = verify_residual_watermark(
                    source,
                    candidate_pixels,
                    width,
                    height,
                    channel,
                    profile_box,
                    profile_box,
                    detection["polarity"],
                    detection["threshold"],
                    detection["baselineResidualScore"],
                )
                if (
                    verification["residualWatermarkScore"]
                    > verification_before_trailing["residualWatermarkScore"] + 0.018
                    or (
                        bool(verification_before_trailing.get("removalPassPassed"))
                        and not bool(verification.get("removalPassPassed"))
                    )
                ):
                    candidate_pixels = bytes(mutable)
                    verification = verification_before_trailing
                    trailing_cleanup_applied = False
        structure_break = measure_structure_preservation(
            source,
            candidate_pixels,
            width,
            height,
            channel,
            profile_box,
        )
        score = (
            verification["residualWatermarkScore"] * 0.52
            + verification["damageTextureDelta"] * 0.2
            + verification["damageSeamScore"] * 0.12
            + verification["brightnessDelta"] * 0.08
            + structure_break * 0.08
        )
        candidates.append(
            {
                "candidateId": profile_id,
                "method": method,
                "fallbackChain": fallback_chain,
                "maskBox": profile_box,
                "maskPoints": effective_points,
                "pixels": candidate_pixels,
                "verification": verification,
                "structureBreakScore": structure_break,
                "score": round(score, 6),
                "residualHotspotBox": residual_hotspot_box,
                "trailingCleanupMaskBox": trailing_cleanup_mask_box,
                "trailingCleanupApplied": trailing_cleanup_applied,
                "protectedPoints": protected_points,
                **trailing_cleanup_diagnostics,
            }
        )

    base_candidate = next((row for row in candidates if row["candidateId"] == "candidate_a_conservative"), candidates[0])
    texture_abort_triggered = False
    aborted_candidate_name = None
    texture_delta_increase = 0.0
    aborted_candidates: list[tuple[str, float]] = []
    filtered_candidates: list[dict[str, Any]] = []
    for row in candidates:
        if row["candidateId"] == base_candidate["candidateId"]:
            filtered_candidates.append(row)
            continue
        delta = float(row["verification"]["damageTextureDelta"]) - float(base_candidate["verification"]["damageTextureDelta"])
        if delta > LIGHT_COMPLEX_TEXTURE_SURGE_ABORT_DELTA:
            texture_abort_triggered = True
            aborted_candidates.append((row["candidateId"], round(delta, 6)))
            if aborted_candidate_name is None or row["verification"]["residualWatermarkScore"] < next(
                cand["verification"]["residualWatermarkScore"] for cand in candidates if cand["candidateId"] == aborted_candidate_name
            ):
                aborted_candidate_name = row["candidateId"]
                texture_delta_increase = round(delta, 6)
            continue
        filtered_candidates.append(row)
    if not filtered_candidates:
        filtered_candidates = [base_candidate]
    if texture_abort_triggered and aborted_candidate_name is None and aborted_candidates:
        aborted_candidate_name = aborted_candidates[0][0]
        texture_delta_increase = aborted_candidates[0][1]

    preferred = [
        row
        for row in filtered_candidates
        if row["method"] is not None
        and row["verification"]["damageSeamScore"] <= LIGHT_COMPLEX_SEAM_PASS
        and row["verification"]["brightnessDelta"] <= LIGHT_COMPLEX_BRIGHTNESS_PASS
        and row["structureBreakScore"] <= LIGHT_COMPLEX_STRUCTURE_BREAK_PASS
    ]
    selected_candidate_reason = "min_score_preferred" if preferred else "min_score_all"
    selected = min(preferred, key=lambda row: row["score"]) if preferred else min(filtered_candidates, key=lambda row: row["score"])
    seam_guard_triggered = False
    brightness_guard_triggered = False
    near_residual_candidates = [
        row
        for row in filtered_candidates
        if row["method"] is not None
        and row["verification"]["residualWatermarkScore"]
        <= selected["verification"]["residualWatermarkScore"] + LIGHT_COMPLEX_RERANK_RESIDUAL_EPSILON
        and (
            not bool(selected["verification"].get("removalPassPassed"))
            or bool(row["verification"].get("removalPassPassed"))
        )
    ]
    if near_residual_candidates:
        seam_brightness_choice = min(
            near_residual_candidates,
            key=lambda row: (
                row["verification"]["damageSeamScore"] * 0.54
                + row["verification"]["brightnessDelta"] * 0.34
                + row["structureBreakScore"] * 0.12,
                row["verification"]["residualWatermarkScore"],
            ),
        )
        seam_gain = selected["verification"]["damageSeamScore"] - seam_brightness_choice["verification"]["damageSeamScore"]
        brightness_gain = selected["verification"]["brightnessDelta"] - seam_brightness_choice["verification"]["brightnessDelta"]
        if seam_brightness_choice["candidateId"] != selected["candidateId"] and (seam_gain >= 0.01 or brightness_gain >= 0.01):
            selected = seam_brightness_choice
            selected_candidate_reason = "v4_residual_tie_lower_seam_brightness"
    if selected["verification"]["damageSeamScore"] > LIGHT_COMPLEX_SEAM_HARD_CAP:
        seam_guard_triggered = True
    if selected["verification"]["brightnessDelta"] > LIGHT_COMPLEX_BRIGHTNESS_HARD_CAP:
        brightness_guard_triggered = True
    if seam_guard_triggered or brightness_guard_triggered:
        guarded_candidates = [
            row
            for row in filtered_candidates
            if row["method"] is not None
            and row["verification"]["residualWatermarkScore"]
            <= selected["verification"]["residualWatermarkScore"] + LIGHT_COMPLEX_RERANK_RESIDUAL_EPSILON * 2
            and row["verification"]["damageSeamScore"] <= selected["verification"]["damageSeamScore"] + 0.004
            and row["verification"]["brightnessDelta"] <= selected["verification"]["brightnessDelta"] + 0.004
        ]
        if guarded_candidates:
            guarded_choice = min(
                guarded_candidates,
                key=lambda row: (
                    row["verification"]["damageSeamScore"] > LIGHT_COMPLEX_SEAM_HARD_CAP,
                    row["verification"]["brightnessDelta"] > LIGHT_COMPLEX_BRIGHTNESS_HARD_CAP,
                    row["verification"]["damageSeamScore"],
                    row["verification"]["brightnessDelta"],
                    row["verification"]["residualWatermarkScore"],
                ),
            )
            if guarded_choice["candidateId"] != selected["candidateId"]:
                selected = guarded_choice
                selected_candidate_reason = "v4_seam_brightness_guard"
    if (
        selected["verification"]["damageSeamScore"] > LIGHT_COMPLEX_SEAM_PASS
        or selected["verification"]["brightnessDelta"] > LIGHT_COMPLEX_BRIGHTNESS_PASS
        or selected["structureBreakScore"] > LIGHT_COMPLEX_STRUCTURE_BREAK_PASS
    ):
        conservative = next((row for row in filtered_candidates if row["candidateId"] == "candidate_a_conservative"), selected)
        if conservative["score"] <= selected["score"] * 1.25:
            selected = conservative
            selected_candidate_reason = "conservative_swap"
    apply_light_complex_verification_thresholds(
        selected["verification"],
        selected["method"],
        selected["structureBreakScore"],
    )
    seam_ring_pixels, seam_ring_verification, seam_ring_diagnostics = try_apply_seam_ring_harmonization(
        source,
        selected["pixels"],
        width,
        height,
        channel,
        selected["verification"],
        selected["maskBox"],
        selected["trailingCleanupMaskBox"] if isinstance(selected.get("trailingCleanupMaskBox"), Box) else None,
        detection["polarity"],
        detection["threshold"],
        detection["baselineResidualScore"],
        selected.get("protectedPoints", set()),
        selected["method"],
        selected["structureBreakScore"],
    )
    selected["pixels"] = seam_ring_pixels
    selected["verification"] = seam_ring_verification
    selected.update(seam_ring_diagnostics)
    if enable_seam_micro_polish:
        micro_pixels, micro_verification, micro_diagnostics = try_apply_seam_micro_polish(
            source,
            selected["pixels"],
            width,
            height,
            channel,
            selected["verification"],
            selected["maskBox"],
            selected["trailingCleanupMaskBox"] if isinstance(selected.get("trailingCleanupMaskBox"), Box) else None,
            detection["polarity"],
            detection["threshold"],
            detection["baselineResidualScore"],
            selected.get("protectedPoints", set()),
            selected["method"],
            selected["structureBreakScore"],
            seam_ring_diagnostics,
        )
    else:
        micro_pixels = selected["pixels"]
        micro_verification = selected["verification"]
        micro_diagnostics = default_seam_micro_polish_diagnostics()
        micro_diagnostics["seamMicroPolishRejectedReason"] = "disabled_by_config"
    selected["pixels"] = micro_pixels
    selected["verification"] = micro_verification
    selected.update(micro_diagnostics)
    selected["textureSurgeAbortTriggered"] = texture_abort_triggered
    selected["abortedCandidateName"] = aborted_candidate_name
    selected["textureDeltaIncrease"] = texture_delta_increase
    selected["fallbackCandidateName"] = selected["candidateId"]
    selected["seamGuardTriggered"] = seam_guard_triggered
    selected["brightnessGuardTriggered"] = brightness_guard_triggered
    selected["structureProtectionTriggered"] = bool(selected.get("structureProtectionTriggered"))
    selected["selectedCandidateReason"] = selected_candidate_reason
    selected["candidates"] = [
        {
            "candidateId": row["candidateId"],
            "method": row["method"],
            "score": row["score"],
            "structureBreakScore": row["structureBreakScore"],
            "residualWatermarkScore": row["verification"]["residualWatermarkScore"],
            "damageTextureDelta": row["verification"]["damageTextureDelta"],
            "damageSeamScore": row["verification"]["damageSeamScore"],
            "brightnessDelta": row["verification"]["brightnessDelta"],
            "residualHotspotBox": box_to_json(row["residualHotspotBox"]) if isinstance(row["residualHotspotBox"], Box) else None,
            "trailingCleanupMaskBox": box_to_json(row["trailingCleanupMaskBox"]) if isinstance(row["trailingCleanupMaskBox"], Box) else None,
            "trailingCleanupApplied": row["trailingCleanupApplied"],
            "trailingFeatherRadius": row["trailingFeatherRadius"],
            "trailingBrightnessMatched": row["trailingBrightnessMatched"],
            "trailingBrightnessBefore": row["trailingBrightnessBefore"],
            "trailingBrightnessAfter": row["trailingBrightnessAfter"],
            "trailingSeamBefore": row["trailingSeamBefore"],
            "trailingSeamAfter": row["trailingSeamAfter"],
            "structureProtectionTriggered": row["structureProtectionTriggered"],
        }
        for row in candidates
    ]
    selected["residualHotspotBox"] = selected["residualHotspotBox"]
    selected["trailingCleanupMaskBox"] = selected["trailingCleanupMaskBox"]
    selected["trailingCleanupApplied"] = selected["trailingCleanupApplied"]
    selected["trailingFeatherRadius"] = selected["trailingFeatherRadius"]
    selected["trailingBrightnessMatched"] = selected["trailingBrightnessMatched"]
    selected["trailingBrightnessBefore"] = selected["trailingBrightnessBefore"]
    selected["trailingBrightnessAfter"] = selected["trailingBrightnessAfter"]
    selected["trailingSeamBefore"] = selected["trailingSeamBefore"]
    selected["trailingSeamAfter"] = selected["trailingSeamAfter"]
    return selected


def apply_repair(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_points: set[tuple[int, int]],
    mask_box: Box,
    page_theme: str,
    degraded_mode: bool,
    aggressive: bool = False,
    page_style_class: str = "mixed_structure",
) -> tuple[str | None, list[str]]:
    fallback_chain: list[str] = []
    luminance_variance = estimate_border_variance(pixels, width, height, channel, box)
    if degraded_mode:
        fallback_chain.append("degraded:no_opencv")
    if page_style_class == "dark_glow_panel":
        if repair_dark_glow_panel(original_pixels, pixels, width, height, channel, box, mask_box, mask_points):
            return "dark_glow_panel_reconstruction", [*fallback_chain, "dark_glow_panel_reconstruction", "feather_edge_blend"]
    if page_style_class == "light_gridline":
        if repair_light_gridline(original_pixels, pixels, width, height, channel, box, mask_box, mask_points):
            return "light_gridline_repair_v1", [*fallback_chain, "light_gridline_repair_v1", "feather_edge_blend"]
    if page_style_class == "light_gradient":
        if repair_light_gradient(original_pixels, pixels, width, height, channel, box, mask_box, mask_points):
            return "light_gradient_repair_v1", [*fallback_chain, "light_gradient_repair_v1", "feather_edge_blend"]
    if page_style_class == "light_plain":
        if repair_light_plain(original_pixels, pixels, width, height, channel, box, mask_box, mask_points):
            return "light_plain_repair_v1", [*fallback_chain, "light_plain_repair_v1", "feather_edge_blend"]
    if page_style_class == "light_complex_diagram":
        if repair_light_complex_diagram(
            original_pixels,
            pixels,
            width,
            height,
            channel,
            box,
            mask_box,
            mask_points,
            degraded_mode=degraded_mode,
        ):
            return "light_complex_diagram_repair_v1", [
                *fallback_chain,
                "light_complex_diagram_repair_v1",
                "feather_edge_blend",
            ]
    if page_theme == "dark_image_page":
        if luminance_variance < 1400:
            apply_gradient_fill(pixels, width, height, channel, box, mask_points)
            blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
            return "gradient_fill", [*fallback_chain, "dark_image_page:gradient_fill_primary", "feather_edge_blend"]
        if HAS_OPENCV and try_opencv_inpaint(pixels, width, height, channel, mask_points):
            blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
            return "opencv_inpaint", [*fallback_chain, "dark_image_page:opencv_inpaint", "feather_edge_blend"]
        if apply_dark_background_reconstruction(pixels, width, height, channel, box, mask_points):
            blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
            return "background_reconstruction", [
                *fallback_chain,
                "dark_image_page:local_background_reconstruction",
                "feather_edge_blend",
            ]
        if not degraded_mode and try_clone_patch(pixels, width, height, channel, box, mask_points):
            blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
            return "clone_patch", [*fallback_chain, "dark_image_page:clone_patch", "feather_edge_blend"]
        apply_gradient_fill(pixels, width, height, channel, box, mask_points)
        blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
        return "gradient_fill", [*fallback_chain, "dark_image_page:gradient_fill_fallback", "feather_edge_blend"]
    if HAS_OPENCV and try_opencv_inpaint(pixels, width, height, channel, mask_points):
        blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
        return "opencv_inpaint", ["light_document_page:opencv_inpaint", "feather_edge_blend"]
    if not degraded_mode and try_clone_patch(pixels, width, height, channel, box, mask_points):
        blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
        return "clone_patch", [*fallback_chain, "light_document_page:clone_patch", "feather_edge_blend"]
    if luminance_variance < 420 or aggressive:
        apply_gradient_fill(pixels, width, height, channel, box, mask_points)
        blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
        return "gradient_fill", [*fallback_chain, "light_document_page:gradient_fill", "feather_edge_blend"]
    if degraded_mode:
        apply_gradient_fill(pixels, width, height, channel, box, mask_points)
        blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
        return "gradient_fill", [*fallback_chain, "degraded:gradient_fill", "feather_edge_blend"]
    return None, [*fallback_chain, "repair_method_exhausted"]


def estimate_border_variance(
    pixels: bytearray, width: int, height: int, channel: int, box: Box
) -> float:
    values: list[int] = []
    top_y = max(0, box.y - 2)
    bottom_y = min(height - 1, box.y + box.height + 1)
    left_x = max(0, box.x - 2)
    right_x = min(width - 1, box.x + box.width + 1)

    for xx in range(box.x, min(width, box.x + box.width)):
        values.append(to_gray(*read_rgb(pixels, width, channel, xx, top_y)))
        values.append(to_gray(*read_rgb(pixels, width, channel, xx, bottom_y)))
    for yy in range(box.y, min(height, box.y + box.height)):
        values.append(to_gray(*read_rgb(pixels, width, channel, left_x, yy)))
        values.append(to_gray(*read_rgb(pixels, width, channel, right_x, yy)))

    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return sum((value - mean) ** 2 for value in values) / len(values)


def classify_page_theme(pixels: bytearray, width: int, height: int, channel: int, roi: Box) -> str:
    values: list[int] = []
    for yy in range(roi.y, roi.y + roi.height):
        for xx in range(roi.x, roi.x + roi.width):
            values.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
    if not values:
        return "light_document_page"
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    std = variance ** 0.5
    if mean < 145 or std > 58:
        return "dark_image_page"
    return "light_document_page"


def classify_page_style(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
) -> str:
    ring = expand_box_asymmetric_anchor(box, width, height, left=24, top=24, right=8, bottom=8)
    bright_line_segments = detect_structure_lines(pixels, width, height, channel, ring)
    dark_line_segments = detect_structure_lines(pixels, width, height, channel, ring, prefer_dark=True)
    line_score = min(1.0, len(bright_line_segments) / 5)
    dark_line_score = min(1.0, len(dark_line_segments) / 4)
    glow_score = estimate_glow_score(pixels, width, height, channel, ring)
    mean_gray = estimate_crop_mean_gray(pixels, width, height, channel, ring)
    std_gray = estimate_crop_std_gray(pixels, width, height, channel, ring)
    gradient_score = estimate_gradient_strength(pixels, width, height, channel, ring)
    if mean_gray < 72 and glow_score >= 0.01:
        return "dark_glow_panel"
    if mean_gray < 72 and glow_score < 0.01:
        return "dark_plain"
    if dark_line_score >= 0.25:
        return "light_gridline"
    if gradient_score >= 0.1 and std_gray < 34:
        return "light_gradient"
    if std_gray <= 18 and dark_line_score < 0.25:
        return "light_plain"
    if std_gray >= 24:
        return "light_complex_diagram"
    return "mixed_structure"


def estimate_glow_score(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
) -> float:
    bright_hits = 0
    total = 0
    band_y1 = min(height, box.y + max(8, box.height // 3))
    for yy in range(max(0, box.y - 16), band_y1):
        for xx in range(box.x, min(width, box.x + box.width)):
            gray = to_gray(*read_rgb(pixels, width, channel, xx, yy))
            if gray >= 110:
                bright_hits += 1
            total += 1
    return bright_hits / max(1, total)


def estimate_crop_mean_gray(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
) -> float:
    values: list[int] = []
    for yy in range(box.y, min(height, box.y + box.height)):
        for xx in range(box.x, min(width, box.x + box.width)):
            values.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
    return sum(values) / max(1, len(values))


def estimate_crop_std_gray(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
) -> float:
    values: list[int] = []
    for yy in range(box.y, min(height, box.y + box.height)):
        for xx in range(box.x, min(width, box.x + box.width)):
            values.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    return variance ** 0.5


def estimate_gradient_strength(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
) -> float:
    if box.width < 4 or box.height < 4:
        return 0.0
    row_means: list[float] = []
    col_means: list[float] = []
    for yy in range(box.y, min(height, box.y + box.height)):
        row = [
            to_gray(*read_rgb(pixels, width, channel, xx, yy))
            for xx in range(box.x, min(width, box.x + box.width))
        ]
        row_means.append(sum(row) / max(1, len(row)))
    for xx in range(box.x, min(width, box.x + box.width)):
        col = [
            to_gray(*read_rgb(pixels, width, channel, xx, yy))
            for yy in range(box.y, min(height, box.y + box.height))
        ]
        col_means.append(sum(col) / max(1, len(col)))
    row_span = abs(row_means[0] - row_means[-1]) / 255.0
    col_span = abs(col_means[0] - col_means[-1]) / 255.0
    local_jitter = (
        sum(abs(row_means[idx] - row_means[idx - 1]) for idx in range(1, len(row_means)))
        / max(1, len(row_means) - 1)
        / 255.0
    )
    return max(row_span, col_span) - min(local_jitter, LIGHT_GRADIENT_BRIGHTNESS_JITTER)


def collect_anchor_foreground_points(
    pixels: bytearray, width: int, channel: int, roi: Box, page_theme: str
) -> tuple[list[tuple[int, int]], int, str]:
    grays: list[int] = []
    for yy in range(roi.y, roi.y + roi.height):
        for xx in range(roi.x, roi.x + roi.width):
            grays.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
    if not grays:
        return [], 0, "dark"

    mean = sum(grays) / len(grays)
    variance = sum((gray - mean) ** 2 for gray in grays) / len(grays)
    std = variance ** 0.5
    dark_threshold = min(180, max(34, int(mean - max(12, std * 0.62))))
    light_threshold = max(76, min(238, int(mean + max(12, std * 0.62))))

    dark_points: list[tuple[int, int]] = []
    light_points: list[tuple[int, int]] = []
    for yy in range(roi.y, roi.y + roi.height):
        for xx in range(roi.x, roi.x + roi.width):
            gray = to_gray(*read_rgb(pixels, width, channel, xx, yy))
            if gray <= dark_threshold:
                dark_points.append((xx, yy))
            if gray >= light_threshold:
                light_points.append((xx, yy))

    roi_area = max(1, roi.width * roi.height)
    if page_theme == "dark_image_page" and len(light_points) >= max(180, int(roi_area * 0.025)):
        return light_points, light_threshold, "light"
    if len(dark_points) >= len(light_points):
        return dark_points, dark_threshold, "dark"
    return light_points, light_threshold, "light"


def refine_with_notebooklm_template(
    points: list[tuple[int, int]],
    raw_box: Box,
    width: int,
    height: int,
    dominant_template: TemplateLock | None,
) -> tuple[Box, float]:
    point_set = set(points)
    search = template_search_box(width, height)
    centers = [
        (raw_box.x + raw_box.width // 2, raw_box.y + raw_box.height // 2),
        (int(width * ANCHOR_X_RATIO), int(height * ANCHOR_Y_RATIO)),
    ]
    if dominant_template is None:
        sizes = [(int(spec["width"]), int(spec["height"])) for spec in TEMPLATE_SPECS.values()]
    else:
        sizes = [
            (
                max(8, dominant_template.width + width_delta),
                max(6, dominant_template.height + height_delta),
            )
            for width_delta in (-MAX_WIDTH_DRIFT_PX, 0, MAX_WIDTH_DRIFT_PX)
            for height_delta in (-MAX_HEIGHT_DRIFT_PX, 0, MAX_HEIGHT_DRIFT_PX)
        ]
    best_box = fallback_template_box(width, height)
    best_score = -1.0
    for center_x, center_y in centers:
        for candidate_w, candidate_h in sizes:
            for offset_x in (-MAX_X_DRIFT_PX, 0, MAX_X_DRIFT_PX):
                for offset_y in (-MAX_Y_DRIFT_PX, 0, MAX_Y_DRIFT_PX):
                    x = int(center_x + offset_x - candidate_w / 2)
                    y = int(center_y + offset_y - candidate_h / 2)
                    box = constrain_box_to_search(Box(x=x, y=y, width=candidate_w, height=candidate_h), search)
                    score = score_template_box(point_set, box, width, height)
                    if score > best_score:
                        best_score = score
                        best_box = box
    return best_box, best_score


def score_template_box(point_set: set[tuple[int, int]], box: Box, width: int, height: int) -> float:
    inside = 0
    left_half = 0
    right_half = 0
    mid_x = box.x + box.width // 2
    for x, y in point_set:
        if box.x <= x < box.x + box.width and box.y <= y < box.y + box.height:
            inside += 1
            if x < mid_x:
                left_half += 1
            else:
                right_half += 1
    area = max(1, box.width * box.height)
    density = inside / area
    if density <= 0:
        return -1.0
    density_score = 1.0 - min(1.0, abs(density - 0.18) / 0.18)
    balance_score = min(left_half, right_half) / max(1, max(left_half, right_half))
    center_x = box.x + box.width / 2
    center_y = box.y + box.height / 2
    anchor_penalty = (
        abs(center_x - width * ANCHOR_X_RATIO) / max(1, width * ANCHOR_MAX_DX_RATIO)
        + abs(center_y - height * ANCHOR_Y_RATIO) / max(1, height * ANCHOR_MAX_DY_RATIO)
    )
    return density_score * 0.55 + balance_score * 0.2 + min(inside / 80, 1.0) * 0.25 - anchor_penalty * 0.18


def constrain_box_to_search(box: Box, search: Box) -> Box:
    next_w = min(box.width, search.width)
    next_h = min(box.height, search.height)
    next_x = min(search.x + search.width - next_w, max(search.x, box.x))
    next_y = min(search.y + search.height - next_h, max(search.y, box.y))
    return Box(x=next_x, y=next_y, width=next_w, height=next_h)


def nearest_template(width: int, height: int) -> tuple[str, int, int]:
    best_id = "template_wide"
    best_distance = float("inf")
    for template_id, spec in TEMPLATE_SPECS.items():
        template_width = int(spec["width"])
        template_height = int(spec["height"])
        distance = abs(width - template_width) + abs(height - template_height) * 2
        if distance < best_distance:
            best_id = template_id
            best_distance = distance
    spec = TEMPLATE_SPECS[best_id]
    return best_id, int(spec["width"]), int(spec["height"])


def lock_box_to_dominant_template(box: Box, template: TemplateLock, width: int, height: int) -> Box:
    anchor_x = width - template.margin_right - template.width
    anchor_y = height - template.margin_bottom - template.height
    drift_x = clamp_int(box.x - anchor_x, -MAX_X_DRIFT_PX, MAX_X_DRIFT_PX)
    drift_y = clamp_int(box.y - anchor_y, -MAX_Y_DRIFT_PX, MAX_Y_DRIFT_PX)
    drift_w = clamp_int(box.width - template.width, -MAX_WIDTH_DRIFT_PX, MAX_WIDTH_DRIFT_PX)
    drift_h = clamp_int(box.height - template.height, -MAX_HEIGHT_DRIFT_PX, MAX_HEIGHT_DRIFT_PX)
    return Box(
        x=max(0, min(width - 1, anchor_x + drift_x)),
        y=max(0, min(height - 1, anchor_y + drift_y)),
        width=max(8, min(width, template.width + drift_w)),
        height=max(6, min(height, template.height + drift_h)),
    )


def clamp_to_notebooklm_template(box: Box, width: int, height: int) -> tuple[Box, bool, bool]:
    search = template_search_box(width, height)
    max_w = max(8, int(width * MAX_BOX_WIDTH_RATIO))
    max_h = max(6, int(height * MAX_BOX_HEIGHT_RATIO))
    max_area = max(1, int(width * height * MAX_BOX_AREA_RATIO))
    target_w = max(8, int(width * TARGET_BOX_WIDTH_RATIO))
    target_h = max(6, int(height * TARGET_BOX_HEIGHT_RATIO))

    was_shrunk = box.width > max_w or box.height > max_h or box.width * box.height > max_area
    next_w = min(max_w, max(target_w, min(box.width, max_w)))
    next_h = min(max_h, max(target_h, min(box.height, max_h)))
    if next_w * next_h > max_area:
        scale = (max_area / max(1, next_w * next_h)) ** 0.5
        next_w = max(8, int(next_w * scale))
        next_h = max(6, int(next_h * scale))
    center_x = min(search.x + search.width, max(search.x, box.x + box.width // 2))
    center_y = min(search.y + search.height, max(search.y, box.y + box.height // 2))
    next_x = min(search.x + search.width - next_w, max(search.x, center_x - next_w // 2))
    next_y = min(search.y + search.height - next_h, max(search.y, center_y - next_h // 2))
    clamped = Box(x=next_x, y=next_y, width=next_w, height=next_h)
    was_clamped = (
        clamped.x != box.x or clamped.y != box.y or clamped.width != box.width or clamped.height != box.height
    )
    return clamped, was_clamped, was_shrunk


def template_search_box(width: int, height: int) -> Box:
    x = int(width * SEARCH_X_MIN)
    y = int(height * SEARCH_Y_MIN)
    return Box(
        x=x,
        y=y,
        width=max(1, int(width * SEARCH_X_MAX) - x),
        height=max(1, int(height * SEARCH_Y_MAX) - y),
    )


def fallback_template_box(width: int, height: int) -> Box:
    box_w = max(8, int(width * TARGET_BOX_WIDTH_RATIO))
    box_h = max(6, int(height * TARGET_BOX_HEIGHT_RATIO))
    center_x = int(width * ANCHOR_X_RATIO)
    center_y = int(height * ANCHOR_Y_RATIO)
    search = template_search_box(width, height)
    x = min(search.x + search.width - box_w, max(search.x, center_x - box_w // 2))
    y = min(search.y + search.height - box_h, max(search.y, center_y - box_h // 2))
    return Box(x=x, y=y, width=box_w, height=box_h)


def is_near_standard_anchor(box: Box, width: int, height: int) -> bool:
    center_x = box.x + box.width / 2
    center_y = box.y + box.height / 2
    return (
        abs(center_x - width * ANCHOR_X_RATIO) <= width * ANCHOR_MAX_DX_RATIO
        and abs(center_y - height * ANCHOR_Y_RATIO) <= height * ANCHOR_MAX_DY_RATIO
    )


def looks_like_multiline_content(points: list[tuple[int, int]], box: Box) -> bool:
    rows = sorted({y for _, y in points if box.y <= y < box.y + box.height})
    if len(rows) < max(8, int(box.height * 0.32)):
        return False
    bands = 1
    for index in range(1, len(rows)):
        if rows[index] - rows[index - 1] > 3:
            bands += 1
    return bands >= 3 and box.height > 18


def shrink_box_to_area_limit(box: Box, width: int, height: int) -> Box:
    max_area = int(width * height * MAX_REPAIR_AREA_RATIO)
    if box.width * box.height <= max_area:
        return box
    scale = (max_area / max(1, box.width * box.height)) ** 0.5
    next_w = max(8, int(box.width * scale))
    next_h = max(6, int(box.height * scale))
    center_x = box.x + box.width // 2
    center_y = box.y + box.height // 2
    search = template_search_box(width, height)
    next_x = min(search.x + search.width - next_w, max(search.x, center_x - next_w // 2))
    next_y = min(search.y + search.height - next_h, max(search.y, center_y - next_h // 2))
    return Box(x=next_x, y=next_y, width=next_w, height=next_h)


def shrink_mask_box(box: Box, max_mask_height: int) -> Box:
    next_h = min(max_mask_height, max(6, int(box.height * 0.55)))
    next_y = box.y + max(0, (box.height - next_h) // 2)
    return Box(x=box.x, y=next_y, width=box.width, height=next_h)


def center_shrink_box(box: Box, target_height: int) -> Box:
    next_h = min(box.height - 1, max(6, target_height))
    next_y = box.y + max(0, (box.height - next_h) // 2)
    return Box(x=box.x, y=next_y, width=box.width, height=next_h)


def expand_mask_box_to_min_height(mask_box: Box, bounds: Box, min_height: int) -> Box:
    if mask_box.height >= min_height:
        return mask_box
    next_h = min(bounds.height - 1, max(min_height, mask_box.height))
    center_y = mask_box.y + mask_box.height // 2
    next_y = min(bounds.y + bounds.height - next_h, max(bounds.y, center_y - next_h // 2))
    return Box(x=mask_box.x, y=next_y, width=mask_box.width, height=next_h)


def merge_mask_with_box(mask_points: set[tuple[int, int]], box: Box) -> set[tuple[int, int]]:
    result = set(mask_points)
    columns = sorted({x for x, _ in mask_points if box.x <= x < box.x + box.width})
    if not columns:
        columns = list(range(box.x, box.x + box.width))
    for xx in columns:
        for yy in range(box.y, box.y + box.height):
            result.add((xx, yy))
    return result


def expand_box_for_second_pass(box: Box, width: int, height: int) -> Box:
    expand_ratio = 0.12
    expand_x = max(SECOND_PASS_EXPAND_LEFT, int(box.width * expand_ratio))
    expand_y = max(SECOND_PASS_EXPAND_TOP, int(box.height * expand_ratio))
    return expand_box_asymmetric_anchor(
        box,
        width,
        height,
        left=expand_x + max(8, int(box.width * 0.05)),
        top=expand_y + max(6, int(box.height * 0.06)),
        right=max(4, SECOND_PASS_EXPAND_WIDTH // 2),
        bottom=max(4, SECOND_PASS_EXPAND_HEIGHT // 2),
    )


def build_small_mask_points(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    threshold: int,
    polarity: str,
    dilation_radius: int = MASK_DILATION_PX,
) -> set[tuple[int, int]]:
    seeds: set[tuple[int, int]] = set()
    for yy in range(box.y, min(height, box.y + box.height)):
        for xx in range(box.x, min(width, box.x + box.width)):
            gray = to_gray(*read_rgb(pixels, width, channel, xx, yy))
            if (polarity == "dark" and gray <= threshold) or (polarity == "light" and gray >= threshold):
                seeds.add((xx, yy))
    return dilate_points(seeds, box, dilation_radius)


def build_glyph_driven_mask_points(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    threshold: int,
    polarity: str,
) -> dict[str, Any]:
    seeds: set[tuple[int, int]] = set()
    for yy in range(box.y, min(height, box.y + box.height)):
        for xx in range(box.x, min(width, box.x + box.width)):
            r, g, b = read_rgb(pixels, width, channel, xx, yy)
            gray = to_gray(r, g, b)
            saturation = max(r, g, b) - min(r, g, b)
            low_saturation = saturation <= 42
            hit = (polarity == "light" and gray >= threshold and low_saturation) or (
                polarity == "dark" and gray <= threshold
            )
            if hit:
                seeds.add((xx, yy))
    if not seeds:
        return {"points": set(), "glyphBox": None}

    components = connected_components(seeds)
    kept: set[tuple[int, int]] = set()
    candidate_components: list[set[tuple[int, int]]] = []
    for component in components:
        component_box = points_to_box(component)
        area = len(component)
        if area < 6:
            continue
        if component_box.width > int(box.width * 0.92) and component_box.height <= 3:
            continue
        if component_box.height > int(box.height * 0.9):
            continue
        kept.update(component)
        candidate_components.append(component)
    if not kept:
        return {"points": set(), "glyphBox": None, "logoBox": None, "fringeBox": None}

    glyph_box = points_to_box(kept)
    expanded = bottom_biased_glyph_box(glyph_box, box)
    tight_points = {
        (x, y)
        for x, y in kept
        if expanded.x <= x < expanded.x + expanded.width and expanded.y <= y < expanded.y + expanded.height
    }
    logo_component = select_logo_component(candidate_components, box)
    fringe_points = detect_fringe_points(
        pixels,
        width,
        height,
        channel,
        expanded,
        tight_points,
        threshold,
        polarity,
    )
    union_points = tight_points | fringe_points
    return {
        "points": dilate_points(union_points, expanded, GLYPH_DILATION_RADIUS),
        "glyphBox": glyph_box,
        "logoBox": points_to_box(logo_component) if logo_component else None,
        "fringeBox": points_to_box(fringe_points) if fringe_points else None,
    }


def connected_components(points: set[tuple[int, int]]) -> list[set[tuple[int, int]]]:
    remaining = set(points)
    components: list[set[tuple[int, int]]] = []
    while remaining:
        start = remaining.pop()
        stack = [start]
        component = {start}
        while stack:
            x, y = stack.pop()
            for ny in range(y - 1, y + 2):
                for nx in range(x - 1, x + 2):
                    if (nx, ny) in remaining:
                        remaining.remove((nx, ny))
                        component.add((nx, ny))
                        stack.append((nx, ny))
        components.append(component)
    return components


def bottom_biased_glyph_box(glyph_box: Box, bounds: Box) -> Box:
    min_h = max(6, int(bounds.height * MIN_MASK_HEIGHT_RATIO))
    x0 = max(bounds.x, glyph_box.x - GLYPH_MARGIN_X)
    x1 = min(bounds.x + bounds.width, glyph_box.x + glyph_box.width + GLYPH_MARGIN_X)
    y0 = max(bounds.y, glyph_box.y - GLYPH_MARGIN_TOP)
    y1 = min(bounds.y + bounds.height, glyph_box.y + glyph_box.height + GLYPH_MARGIN_BOTTOM)
    if y1 - y0 < min_h:
        missing = min_h - (y1 - y0)
        y0 = max(bounds.y, y0 - missing // 2)
        y1 = min(bounds.y + bounds.height, y1 + missing - missing // 2)
    return Box(x=x0, y=y0, width=max(1, x1 - x0), height=max(1, y1 - y0))


def select_logo_component(
    components: list[set[tuple[int, int]]], bounds: Box
) -> set[tuple[int, int]] | None:
    best_component: set[tuple[int, int]] | None = None
    best_score = -1.0
    mid_x = bounds.x + int(bounds.width * 0.48)
    for component in components:
        component_box = points_to_box(component)
        if component_box.x > mid_x:
            continue
        x_ratio = (component_box.x - bounds.x) / max(1, bounds.width)
        y_ratio = (component_box.y - bounds.y) / max(1, bounds.height)
        area_ratio = len(component) / max(1, bounds.width * bounds.height)
        score = (1.0 - x_ratio) * 0.55 + (1.0 - abs(y_ratio - 0.25)) * 0.2 + min(area_ratio * 28, 1.0) * 0.25
        if score > best_score:
            best_score = score
            best_component = component
    return best_component


def detect_fringe_points(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    core_points: set[tuple[int, int]],
    threshold: int,
    polarity: str,
) -> set[tuple[int, int]]:
    if not core_points:
        return set()
    fringe_candidates = dilate_points(core_points, box, 1) - core_points
    fringe: set[tuple[int, int]] = set()
    for xx, yy in fringe_candidates:
        r, g, b = read_rgb(pixels, width, channel, xx, yy)
        gray = to_gray(r, g, b)
        if abs(gray - threshold) <= 22:
            fringe.add((xx, yy))
            continue
        contrast = local_contrast_score(pixels, width, height, channel, xx, yy)
        if polarity == "light" and gray >= threshold - 18 and contrast >= 12:
            fringe.add((xx, yy))
        if polarity == "dark" and gray <= threshold + 18 and contrast >= 12:
            fringe.add((xx, yy))
    return fringe


def local_contrast_score(
    pixels: bytearray, width: int, height: int, channel: int, x: int, y: int
) -> int:
    center = to_gray(*read_rgb(pixels, width, channel, x, y))
    max_delta = 0
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            nx = min(width - 1, max(0, x + dx))
            ny = min(height - 1, max(0, y + dy))
            delta = abs(center - to_gray(*read_rgb(pixels, width, channel, nx, ny)))
            if delta > max_delta:
                max_delta = delta
    return max_delta


def build_conservative_template_box(
    clamped_box: Box,
    width: int,
    height: int,
    dominant_template: TemplateLock | None,
) -> Box:
    if dominant_template is not None:
        aligned = Box(
            x=max(0, width - dominant_template.margin_right - dominant_template.width),
            y=max(0, height - dominant_template.margin_bottom - dominant_template.height),
            width=min(width, dominant_template.width),
            height=min(height, dominant_template.height),
        )
    else:
        aligned = fallback_template_box(width, height)
    union_box = union_boxes([clamped_box, aligned])
    return expand_box(union_box, width, height, left=6, top=4, right=10, bottom=8)


def build_union_mask_points(
    width: int,
    height: int,
    *,
    detected_box: Box,
    conservative_box: Box,
    glyph_points: set[tuple[int, int]],
    glyph_box: Box | None,
    logo_box: Box | None,
    fringe_box: Box | None,
    force_conservative: bool,
) -> tuple[Box, set[tuple[int, int]]]:
    union_members = [detected_box, conservative_box]
    if glyph_box is not None:
        union_members.append(glyph_box)
    if logo_box is not None:
        union_members.append(logo_box)
    if fringe_box is not None:
        union_members.append(fringe_box)
    final_box = union_boxes(union_members)
    if force_conservative:
        final_box = union_boxes([final_box, conservative_box])
    final_box = ensure_min_box_ratio(final_box, detected_box, width, height, MIN_FINAL_MASK_RATIO)
    expanded_box = expand_box_asymmetric_anchor(final_box, width, height, left=12, top=10, right=3, bottom=3)
    return expanded_box, box_to_points(expanded_box)


def dilate_points(points: set[tuple[int, int]], bounds: Box, radius: int) -> set[tuple[int, int]]:
    result: set[tuple[int, int]] = set()
    for x, y in points:
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy > radius * radius:
                    continue
                nx = x + dx
                ny = y + dy
                if bounds.x <= nx < bounds.x + bounds.width and bounds.y <= ny < bounds.y + bounds.height:
                    result.add((nx, ny))
    return result


def points_to_box(points: set[tuple[int, int]]) -> Box:
    min_x = min(point[0] for point in points)
    max_x = max(point[0] for point in points)
    min_y = min(point[1] for point in points)
    max_y = max(point[1] for point in points)
    return Box(x=min_x, y=min_y, width=max_x - min_x + 1, height=max_y - min_y + 1)


def apply_solid_fill(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_points: set[tuple[int, int]],
) -> None:
    rgb = sample_surrounding_color(pixels, width, height, channel, box)
    for xx, yy in mask_points:
        write_rgb(pixels, width, channel, xx, yy, rgb)


def apply_gradient_fill(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_points: set[tuple[int, int]],
) -> None:
    left = sample_column_color(pixels, width, height, channel, max(0, box.x - 2), box)
    right = sample_column_color(
        pixels, width, height, channel, min(width - 1, box.x + box.width + 1), box
    )
    top = sample_row_color(pixels, width, height, channel, max(0, box.y - 2), box)
    bottom = sample_row_color(
        pixels, width, height, channel, min(height - 1, box.y + box.height + 1), box
    )

    max_x = max(1, box.width - 1)
    max_y = max(1, box.height - 1)
    for xx, yy in mask_points:
        ty = (yy - box.y) / max_y
        tx = (xx - box.x) / max_x
        hmix = blend_rgb(left, right, tx)
        vmix = blend_rgb(top, bottom, ty)
        mixed = blend_rgb(hmix, vmix, 0.5)
        write_rgb(pixels, width, channel, xx, yy, mixed)


def apply_dark_background_reconstruction(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    if not mask_points:
        return False
    edge_points = find_edge_points(mask_points)
    for xx, yy in mask_points:
        left = sample_horizontal_color(pixels, width, height, channel, max(0, box.x - 8), yy)
        upper = sample_vertical_color(pixels, width, height, channel, xx, max(0, box.y - 8))
        right = sample_horizontal_color(
            pixels, width, height, channel, min(width - 1, box.x + box.width + 4), yy
        )
        tx = (xx - box.x) / max(1, box.width - 1)
        base = blend_rgb(blend_rgb(left, right, tx), upper, 0.32)
        original = read_rgb(pixels, width, channel, xx, yy)
        repaired = blend_rgb(base, original, 0.04 if (xx, yy) in edge_points else 0.01)
        write_rgb(pixels, width, channel, xx, yy, repaired)
    return True


def repair_dark_gridline(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    apply_gradient_fill(pixels, width, height, channel, box, mask_points)
    line_segments = detect_structure_lines(original_pixels, width, height, channel, mask_box)
    for segment in line_segments:
        redraw_line_segment(pixels, width, height, channel, mask_box, segment)
    blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
    return True


def repair_dark_glow_panel(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    apply_gradient_fill(pixels, width, height, channel, box, mask_points)
    line_segments = detect_structure_lines(original_pixels, width, height, channel, mask_box)
    for segment in line_segments:
        redraw_line_segment(pixels, width, height, channel, mask_box, segment)
    restore_glow_gradient(original_pixels, pixels, width, height, channel, mask_box, mask_points)
    blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
    return True


def repair_light_plain(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    edge_points = find_edge_points(mask_points)
    core_points = {point for point in mask_points if point not in edge_points}
    if not core_points:
        core_points = set(mask_points)
    apply_gradient_fill(pixels, width, height, channel, box, core_points)
    original = bytearray(original_pixels)
    for xx, yy in edge_points:
        repaired = read_rgb(pixels, width, channel, xx, yy)
        preserved = read_rgb(original, width, channel, xx, yy)
        write_rgb(pixels, width, channel, xx, yy, blend_rgb(repaired, preserved, 0.16))
    blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
    return True


def repair_light_gridline(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    apply_gradient_fill(pixels, width, height, channel, box, mask_points)
    line_segments = detect_structure_lines(original_pixels, width, height, channel, mask_box, prefer_dark=True)
    for segment in line_segments:
        redraw_line_segment(pixels, width, height, channel, mask_box, segment)
    blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
    return True


def repair_light_gradient(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    apply_gradient_fill(pixels, width, height, channel, box, mask_points)
    blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
    return True


def repair_light_complex_diagram(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
    *,
    degraded_mode: bool,
) -> bool:
    if not degraded_mode and try_clone_patch(pixels, width, height, channel, box, mask_points):
        blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
        return True
    apply_gradient_fill(pixels, width, height, channel, box, mask_points)
    blend_repair_edges(original_pixels, pixels, width, height, channel, mask_points, mask_box)
    return True


def detect_structure_lines(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
    prefer_dark: bool = False,
) -> list[dict[str, int]]:
    segments: list[dict[str, int]] = []
    sample_left = max(0, mask_box.x - 28)
    sample_right = min(width - 1, mask_box.x + mask_box.width + 28)
    context_values: list[int] = []
    for yy in range(max(0, mask_box.y - 24), min(height, mask_box.y + mask_box.height + 24)):
        for xx in range(sample_left, sample_right):
            context_values.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
    context_mean = sum(context_values) / max(1, len(context_values))
    for yy in range(mask_box.y - 6, mask_box.y + mask_box.height + 6):
        if yy < 1 or yy >= height - 1:
            continue
        row = []
        for xx in range(sample_left, sample_right):
            row.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
        if not row:
            continue
        mean = sum(row) / len(row)
        if prefer_dark:
            if mean > context_mean - 8:
                continue
        elif mean < context_mean + 8:
            continue
        variance = sum((value - mean) ** 2 for value in row) / len(row)
        line_ratio = (
            sum(1 for value in row if value <= context_mean - 8) / len(row)
            if prefer_dark
            else sum(1 for value in row if value >= context_mean + 10) / len(row)
        )
        if variance < 220 and line_ratio >= (0.48 if prefer_dark else 0.55):
            segments.append({"orientation": 0, "position": yy})
    for xx in range(mask_box.x - 6, mask_box.x + mask_box.width + 6):
        if xx < 1 or xx >= width - 1:
            continue
        col = []
        for yy in range(max(0, mask_box.y - 24), min(height, mask_box.y + mask_box.height + 24)):
            col.append(to_gray(*read_rgb(pixels, width, channel, xx, yy)))
        if not col:
            continue
        mean = sum(col) / len(col)
        if prefer_dark:
            if mean > context_mean - 6:
                continue
        elif mean < context_mean + 6:
            continue
        variance = sum((value - mean) ** 2 for value in col) / len(col)
        line_ratio = (
            sum(1 for value in col if value <= context_mean - 7) / len(col)
            if prefer_dark
            else sum(1 for value in col if value >= context_mean + 8) / len(col)
        )
        if variance < 260 and line_ratio >= (0.28 if prefer_dark else 0.32):
            segments.append({"orientation": 90, "position": xx})
    deduped: list[dict[str, int]] = []
    seen: set[tuple[int, int]] = set()
    for segment in segments:
        key = (segment["orientation"], round(segment["position"] / 3))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(segment)
    return deduped


def redraw_line_segment(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
    segment: dict[str, int],
) -> None:
    if segment["orientation"] == 0:
        yy = segment["position"]
        left_color = read_rgb(pixels, width, channel, max(0, mask_box.x - 3), yy)
        right_color = read_rgb(pixels, width, channel, min(width - 1, mask_box.x + mask_box.width + 2), yy)
        target = blend_rgb(left_color, right_color, 0.5)
        for xx in range(mask_box.x, min(width, mask_box.x + mask_box.width)):
            write_rgb(pixels, width, channel, xx, yy, target)
    else:
        xx = segment["position"]
        top_color = read_rgb(pixels, width, channel, xx, max(0, mask_box.y - 3))
        bottom_color = read_rgb(pixels, width, channel, xx, min(height - 1, mask_box.y + mask_box.height + 2))
        target = blend_rgb(top_color, bottom_color, 0.5)
        for yy in range(mask_box.y, min(height, mask_box.y + mask_box.height)):
            write_rgb(pixels, width, channel, xx, yy, target)


def restore_glow_gradient(
    original_pixels: bytes,
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
) -> None:
    top_band_y0 = max(0, mask_box.y - 18)
    top_band_y1 = min(height, mask_box.y + max(6, mask_box.height // 3))
    for yy in range(top_band_y0, top_band_y1):
        for xx in range(mask_box.x, min(width, mask_box.x + mask_box.width)):
            if (xx, yy) not in mask_points:
                continue
            original = read_rgb(bytearray(original_pixels), width, channel, xx, yy)
            left = read_rgb(pixels, width, channel, max(0, mask_box.x - 4), yy)
            right = read_rgb(pixels, width, channel, min(width - 1, mask_box.x + mask_box.width + 3), yy)
            gradient = blend_rgb(left, right, (xx - mask_box.x) / max(1, mask_box.width - 1))
            glow_mix = blend_rgb(gradient, original, 0.18)
            write_rgb(pixels, width, channel, xx, yy, glow_mix)


def blend_repair_edges(
    original_pixels: bytes,
    repaired_pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    mask_points: set[tuple[int, int]],
    mask_box: Box,
) -> None:
    if not mask_points:
        return
    original = bytearray(original_pixels)
    edge_points = find_edge_points(mask_points)
    for xx, yy in edge_points:
        blend_target = sample_background_ring_color(repaired_pixels, width, height, channel, xx, yy, mask_points)
        repaired = read_rgb(repaired_pixels, width, channel, xx, yy)
        mixed = blend_rgb(repaired, blend_target, 0.15)
        write_rgb(repaired_pixels, width, channel, xx, yy, mixed)
    outer_band = find_outer_band_points(mask_points, mask_box)
    for xx, yy in outer_band:
        repaired = read_rgb(repaired_pixels, width, channel, xx, yy)
        preserved = read_rgb(original, width, channel, xx, yy)
        write_rgb(repaired_pixels, width, channel, xx, yy, blend_rgb(repaired, preserved, 0.02))


def find_edge_points(mask_points: set[tuple[int, int]]) -> set[tuple[int, int]]:
    edge_points: set[tuple[int, int]] = set()
    for xx, yy in mask_points:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if (xx + dx, yy + dy) not in mask_points:
                edge_points.add((xx, yy))
                break
    return edge_points


def find_outer_band_points(mask_points: set[tuple[int, int]], mask_box: Box) -> set[tuple[int, int]]:
    result: set[tuple[int, int]] = set()
    for xx, yy in mask_points:
        if (
            xx - mask_box.x <= 1
            or mask_box.x + mask_box.width - 1 - xx <= 1
            or yy - mask_box.y <= 1
            or mask_box.y + mask_box.height - 1 - yy <= 1
        ):
            result.add((xx, yy))
    return result


def sample_background_ring_color(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    x: int,
    y: int,
    mask_points: set[tuple[int, int]],
) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            nx = min(width - 1, max(0, x + dx))
            ny = min(height - 1, max(0, y + dy))
            if (nx, ny) in mask_points:
                continue
            samples.append(read_rgb(pixels, width, channel, nx, ny))
    if not samples:
        return read_rgb(pixels, width, channel, x, y)
    return average_rgb(samples)


def sample_horizontal_color(
    pixels: bytearray, width: int, height: int, channel: int, x: int, y: int
) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    for dy in range(-3, 4):
        yy = min(height - 1, max(0, y + dy))
        samples.append(read_rgb(pixels, width, channel, x, yy))
    return average_rgb(samples)


def sample_vertical_color(
    pixels: bytearray, width: int, height: int, channel: int, x: int, y: int
) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    for dx in range(-3, 4):
        xx = min(width - 1, max(0, x + dx))
        samples.append(read_rgb(pixels, width, channel, xx, y))
    return average_rgb(samples)


def feather_alpha(x: int, y: int, mask_points: set[tuple[int, int]]) -> float:
    neighbor_count = 0
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            if (x + dx, y + dy) in mask_points:
                neighbor_count += 1
    return min(0.97, max(0.72, neighbor_count / 25))


def try_clone_patch(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_points: set[tuple[int, int]],
) -> bool:
    source_x = box.x - box.width - 4
    if source_x < 0:
        return False
    for tx, ty in mask_points:
        sx = source_x + (tx - box.x)
        sy = ty
        if sx >= width or sy >= height or tx >= width or ty >= height:
            continue
        rgb = read_rgb(pixels, width, channel, sx, sy)
        write_rgb(pixels, width, channel, tx, ty, rgb)
    return True


def try_opencv_inpaint(
    pixels: bytearray, width: int, height: int, channel: int, mask_points: set[tuple[int, int]]
) -> bool:
    if not HAS_OPENCV or cv2 is None or np is None:
        return False
    if channel < 3:
        return False
    try:
        arr = np.frombuffer(bytes(pixels), dtype=np.uint8).reshape((height, width, channel))
        bgr = arr[:, :, :3][:, :, ::-1].copy()
        mask = np.zeros((height, width), dtype=np.uint8)
        for x, y in mask_points:
            mask[y, x] = 255
        repaired = cv2.inpaint(bgr, mask, 2, cv2.INPAINT_TELEA)
        rgb = repaired[:, :, ::-1]
        arr[:, :, :3] = rgb
        pixels[:] = bytearray(arr.tobytes())
        return True
    except Exception:  # pylint: disable=broad-except
        return False


def verify_residual_watermark(
    original_pixels: bytes,
    repaired_pixels: bytes,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
    polarity: str,
    threshold: int,
    baseline_score: float | None,
) -> dict[str, Any]:
    before = measure_watermark_presence(original_pixels, width, height, channel, box, polarity, threshold)
    after = measure_watermark_presence(repaired_pixels, width, height, channel, box, polarity, threshold)
    damage = measure_repair_damage(repaired_pixels, width, height, channel, box, mask_box)
    removal_pass = (
        baseline_score is not None
        and after["residualWatermarkScore"] <= max(RESIDUAL_PASS_ABSOLUTE, baseline_score * RESIDUAL_PASS_RATIO)
        and after["templateSimilarityScore"]
        <= max(CORNER_TEMPLATE_RESIDUAL_PASS, before["templateSimilarityScore"] * TEMPLATE_SIMILARITY_PASS_RATIO)
        and after["textResidualScore"] <= TEXT_RESIDUAL_PASS
    )
    damage_pass = (
        damage["damageLumaDelta"] <= DAMAGE_LUMA_PASS
        and damage["damageTextureDelta"] <= DAMAGE_TEXTURE_PASS
        and damage["damageSeamScore"] <= DAMAGE_SEAM_PASS
    )
    return {
        "passed": removal_pass and damage_pass,
        "removalPassPassed": removal_pass,
        "damageControlPassPassed": damage_pass,
        "residualWatermarkScore": after["residualWatermarkScore"],
        "brightGlyphResidualScore": after["brightGlyphResidualScore"],
        "edgeTemplateResidualScore": after["edgeTemplateResidualScore"],
        "cornerTemplateResidual": after["templateSimilarityScore"],
        "templateSimilarityBefore": before["templateSimilarityScore"],
        "templateSimilarityAfter": after["templateSimilarityScore"],
        "textResidualScore": after["textResidualScore"],
        "damageLumaDelta": damage["damageLumaDelta"],
        "brightnessDelta": damage["damageLumaDelta"],
        "damageTextureDelta": damage["damageTextureDelta"],
        "damageSeamScore": damage["damageSeamScore"],
    }


def measure_watermark_presence(
    pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    polarity: str,
    threshold: int,
) -> dict[str, float]:
    glyph_hits = 0
    edge_hits = 0
    text_hits = 0
    total = 0
    weighted_template_hits = 0.0
    weighted_template_total = 0.0
    for yy in range(box.y, min(height, box.y + box.height)):
        previous_gray: int | None = None
        for xx in range(box.x, min(width, box.x + box.width)):
            gray = to_gray(*read_rgb(pixels, width, channel, xx, yy))
            hit = (polarity == "dark" and gray <= threshold) or (polarity == "light" and gray >= threshold)
            if hit:
                glyph_hits += 1
            if previous_gray is not None and abs(gray - previous_gray) >= 28:
                edge_hits += 1
            template_weight = notebooklm_template_weight(xx, yy, box)
            if template_weight > 0:
                weighted_template_total += template_weight
                if hit or local_contrast_score(pixels, width, height, channel, xx, yy) >= 14:
                    weighted_template_hits += template_weight
            if xx >= box.x + int(box.width * 0.42) and yy >= box.y + int(box.height * 0.18):
                if hit:
                    text_hits += 1
            previous_gray = gray
            total += 1
    bright_glyph_score = glyph_hits / max(1, total)
    edge_score = edge_hits / max(1, total)
    text_residual_score = round(text_hits / max(1, int(total * 0.5)), 6)
    template_similarity_score = round(weighted_template_hits / max(0.001, weighted_template_total), 6)
    corner_template_residual = round(
        template_similarity_score * 0.54 + bright_glyph_score * 0.3 + edge_score * 0.16,
        6,
    )
    residual_score = round(
        bright_glyph_score * 0.46 + edge_score * 0.18 + template_similarity_score * 0.24 + text_residual_score * 0.12,
        6,
    )
    return {
        "residualWatermarkScore": residual_score,
        "brightGlyphResidualScore": round(bright_glyph_score, 6),
        "edgeTemplateResidualScore": round(edge_score, 6),
        "cornerTemplateResidual": corner_template_residual,
        "templateSimilarityScore": template_similarity_score,
        "textResidualScore": text_residual_score,
    }


def notebooklm_template_weight(x: int, y: int, box: Box) -> float:
    if box.width <= 0 or box.height <= 0:
        return 0.0
    rel_x = (x - box.x) / max(1, box.width - 1)
    rel_y = (y - box.y) / max(1, box.height - 1)
    icon_hit = 0.0
    if ((rel_x - 0.18) ** 2) / 0.018 + ((rel_y - 0.48) ** 2) / 0.09 <= 1.0:
        icon_hit = 1.0
    text_band = 1.0 if 0.42 <= rel_x <= 0.94 and 0.22 <= rel_y <= 0.72 else 0.0
    upper_text = 1.0 if 0.44 <= rel_x <= 0.9 and 0.24 <= rel_y <= 0.46 else 0.0
    lower_text = 1.0 if 0.44 <= rel_x <= 0.82 and 0.48 <= rel_y <= 0.7 else 0.0
    return icon_hit * 1.2 + text_band * 0.2 + upper_text * 0.55 + lower_text * 0.4


def measure_repair_damage(
    repaired_pixels: bytes | bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    mask_box: Box,
) -> dict[str, float]:
    inner_values: list[int] = []
    ring_values: list[int] = []
    seam_values: list[float] = []
    for yy in range(max(0, mask_box.y - 2), min(height, mask_box.y + mask_box.height + 2)):
        for xx in range(max(0, mask_box.x - 2), min(width, mask_box.x + mask_box.width + 2)):
            gray = to_gray(*read_rgb(repaired_pixels, width, channel, xx, yy))
            inside = mask_box.x <= xx < mask_box.x + mask_box.width and mask_box.y <= yy < mask_box.y + mask_box.height
            if inside:
                inner_values.append(gray)
            else:
                ring_values.append(gray)
    if not inner_values or not ring_values:
        return {"damageLumaDelta": 0.0, "damageTextureDelta": 0.0, "damageSeamScore": 0.0}
    inner_mean = sum(inner_values) / len(inner_values)
    ring_mean = sum(ring_values) / len(ring_values)
    inner_var = sum((value - inner_mean) ** 2 for value in inner_values) / len(inner_values)
    ring_var = sum((value - ring_mean) ** 2 for value in ring_values) / len(ring_values)
    for xx in range(mask_box.x, min(width - 1, mask_box.x + mask_box.width - 1)):
        top_y = max(0, mask_box.y)
        bottom_y = min(height - 2, mask_box.y + mask_box.height - 1)
        seam_values.append(
            abs(
                to_gray(*read_rgb(repaired_pixels, width, channel, xx, top_y))
                - to_gray(*read_rgb(repaired_pixels, width, channel, xx, max(0, top_y - 1)))
            )
            / 255.0
        )
        seam_values.append(
            abs(
                to_gray(*read_rgb(repaired_pixels, width, channel, xx, bottom_y))
                - to_gray(*read_rgb(repaired_pixels, width, channel, xx, min(height - 1, bottom_y + 1)))
            )
            / 255.0
        )
    damage_luma_delta = round(abs(inner_mean - ring_mean) / 255.0, 6)
    damage_texture_delta = round(abs(inner_var - ring_var) / max(1.0, ring_var + 1.0), 6)
    damage_seam_score = round(sum(seam_values) / max(1, len(seam_values)), 6)
    return {
        "damageLumaDelta": damage_luma_delta,
        "damageTextureDelta": damage_texture_delta,
        "damageSeamScore": damage_seam_score,
    }


def sample_surrounding_color(
    pixels: bytearray, width: int, height: int, channel: int, box: Box
) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    for yy in range(max(0, box.y - 3), min(height, box.y + box.height + 3)):
        samples.append(read_rgb(pixels, width, channel, max(0, box.x - 2), yy))
        samples.append(read_rgb(pixels, width, channel, min(width - 1, box.x + box.width + 1), yy))
    for xx in range(max(0, box.x - 3), min(width, box.x + box.width + 3)):
        samples.append(read_rgb(pixels, width, channel, xx, max(0, box.y - 2)))
        samples.append(read_rgb(pixels, width, channel, xx, min(height - 1, box.y + box.height + 1)))
    if not samples:
        return (255, 255, 255)
    r = int(sum(color[0] for color in samples) / len(samples))
    g = int(sum(color[1] for color in samples) / len(samples))
    b = int(sum(color[2] for color in samples) / len(samples))
    return (r, g, b)


def average_rgb(samples: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    if not samples:
        return (0, 0, 0)
    return (
        int(sum(color[0] for color in samples) / len(samples)),
        int(sum(color[1] for color in samples) / len(samples)),
        int(sum(color[2] for color in samples) / len(samples)),
    )


def sample_column_color(
    pixels: bytearray, width: int, height: int, channel: int, x: int, box: Box
) -> tuple[int, int, int]:
    samples = [
        read_rgb(pixels, width, channel, x, yy)
        for yy in range(box.y, min(height, box.y + box.height))
    ]
    if not samples:
        return (255, 255, 255)
    return (
        int(sum(color[0] for color in samples) / len(samples)),
        int(sum(color[1] for color in samples) / len(samples)),
        int(sum(color[2] for color in samples) / len(samples)),
    )


def sample_row_color(
    pixels: bytearray, width: int, height: int, channel: int, y: int, box: Box
) -> tuple[int, int, int]:
    samples = [
        read_rgb(pixels, width, channel, xx, y)
        for xx in range(box.x, min(width, box.x + box.width))
    ]
    if not samples:
        return (255, 255, 255)
    return (
        int(sum(color[0] for color in samples) / len(samples)),
        int(sum(color[1] for color in samples) / len(samples)),
        int(sum(color[2] for color in samples) / len(samples)),
    )


def blend_rgb(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = min(1.0, max(0.0, t))
    return (
        int(a[0] * (1.0 - t) + b[0] * t),
        int(a[1] * (1.0 - t) + b[1] * t),
        int(a[2] * (1.0 - t) + b[2] * t),
    )


def build_page_info(page: fitz.Page, pix: fitz.Pixmap) -> dict[str, Any]:
    return {
        "pageWidth": round(float(page.rect.width), 4),
        "pageHeight": round(float(page.rect.height), 4),
        "renderWidth": pix.width,
        "renderHeight": pix.height,
        "cropBox": rect_to_json(page.cropbox),
        "mediaBox": rect_to_json(page.mediabox),
        "rotation": int(page.rotation),
    }


def rect_to_json(rect: fitz.Rect) -> dict[str, float]:
    return {
        "x0": round(float(rect.x0), 4),
        "y0": round(float(rect.y0), 4),
        "x1": round(float(rect.x1), 4),
        "y1": round(float(rect.y1), 4),
        "width": round(float(rect.width), 4),
        "height": round(float(rect.height), 4),
    }


def normalize_render_box(box: Box, width: int, height: int) -> dict[str, float]:
    return {
        "x": round(box.x / max(1, width), 6),
        "y": round(box.y / max(1, height), 6),
        "width": round(box.width / max(1, width), 6),
        "height": round(box.height / max(1, height), 6),
    }


def map_normalized_box_to_render(box: dict[str, float], width: int, height: int) -> Box:
    return Box(
        x=max(0, min(width - 1, int(round(float(box.get("x", 0)) * width)))),
        y=max(0, min(height - 1, int(round(float(box.get("y", 0)) * height)))),
        width=max(1, min(width, int(round(float(box.get("width", 0)) * width)))),
        height=max(1, min(height, int(round(float(box.get("height", 0)) * height)))),
    )


def default_failed_verification() -> dict[str, Any]:
    return {
        "passed": False,
        "removalPassPassed": False,
        "damageControlPassPassed": False,
        "structureBreakScore": 1.0,
        "residualWatermarkScore": 1.0,
        "brightGlyphResidualScore": 1.0,
        "edgeTemplateResidualScore": 1.0,
        "cornerTemplateResidual": 1.0,
        "templateSimilarityBefore": 1.0,
        "templateSimilarityAfter": 1.0,
        "textResidualScore": 1.0,
        "damageLumaDelta": 1.0,
        "brightnessDelta": 1.0,
        "damageTextureDelta": 1.0,
        "damageSeamScore": 1.0,
    }


def infer_failure_category(
    page_style_class: str,
    visual_verification: dict[str, Any],
    *,
    skip_reason: str | None = None,
) -> str:
    if skip_reason in {"no_template_watermark_mask", "repair_method_failed"}:
        return "watermark removal insufficient"
    if not bool(visual_verification.get("removalPassPassed")):
        return "watermark removal insufficient"
    if float(visual_verification.get("damageLumaDelta", 1.0)) > DAMAGE_LUMA_PASS:
        return "brightness mismatch"
    if (
        page_style_class == "light_gradient"
        and float(visual_verification.get("damageTextureDelta", 1.0)) > DAMAGE_TEXTURE_PASS
    ):
        return "gradient mismatch"
    if float(visual_verification.get("structureBreakScore", 0.0)) > LIGHT_COMPLEX_STRUCTURE_BREAK_PASS:
        return "structure break"
    if page_style_class in {"light_gridline", "light_complex_diagram", "mixed_structure"} and float(
        visual_verification.get("damageSeamScore", 1.0)
    ) > DAMAGE_SEAM_PASS:
        return "structure break"
    if not bool(visual_verification.get("damageControlPassPassed")):
        return "damage too high"
    return "watermark removal insufficient"


def save_debug_artifacts(
    original: bytes,
    repaired_pass1: bytes,
    repaired_pass2: bytes,
    width: int,
    height: int,
    channel: int,
    focus_box: Box,
    expanded_box: Box,
    mask_box: Box,
    mask_points: set[tuple[int, int]],
    page_style_class: str,
    artifact_dir: Path,
) -> dict[str, str]:
    crop_box = expand_box(
        union_boxes([focus_box, expanded_box, mask_box]),
        width,
        height,
        DEBUG_CROP_MARGIN,
        DEBUG_CROP_MARGIN,
        DEBUG_CROP_MARGIN,
        DEBUG_CROP_MARGIN,
    )
    original_crop_path = save_crop_image(
        original,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "original-crop.png",
    )
    repaired_pass1_path = save_crop_image(
        repaired_pass1,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "repaired-crop-pass1.png",
    )
    repaired_pass2_path = save_crop_image(
        repaired_pass2,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "repaired-crop-pass2.png",
    )
    mask_overlay_path = save_mask_overlay_crop(
        original,
        width,
        height,
        channel,
        crop_box,
        mask_points,
        artifact_dir / "mask-overlay.png",
    )
    repaired_final_path = save_crop_image(
        repaired_pass2,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "repaired-crop.png",
    )
    diff_or_residual_path = save_diff_crop(
        original,
        repaired_pass2,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "diff-or-residual.png",
    )
    pass_compare_path = save_diff_crop(
        repaired_pass1,
        repaired_pass2,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "pass1-pass2-compare.png",
    )
    damage_heatmap_path = save_diff_crop(
        original,
        repaired_pass2,
        width,
        height,
        channel,
        crop_box,
        artifact_dir / "damage-heatmap.png",
    )
    structure_line_overlay_path = save_structure_line_overlay(
        original,
        width,
        height,
        channel,
        crop_box,
        expanded_box,
        artifact_dir / "structure-line-overlay.png",
    )
    return {
        "originalCropPath": str(original_crop_path),
        "maskOverlayPath": str(mask_overlay_path),
        "expandedMaskOverlayPath": str(mask_overlay_path),
        "repairedCropPath": str(repaired_final_path),
        "repairedCropPass1Path": str(repaired_pass1_path),
        "repairedCropPass2Path": str(repaired_pass2_path),
        "pass1Pass2ComparePath": str(pass_compare_path),
        "diffOrResidualPath": str(diff_or_residual_path),
        "residualPath": str(diff_or_residual_path),
        "damageHeatmapPath": str(damage_heatmap_path),
        "structureLineOverlayPath": str(structure_line_overlay_path)
        if page_style_class in {"dark_glow_panel", "light_gridline", "light_complex_diagram", "mixed_structure"}
        else "",
    }


def save_crop_image(
    pixels: bytes,
    width: int,
    height: int,
    channel: int,
    crop_box: Box,
    path: Path,
) -> Path:
    cropped = crop_pixels(pixels, width, height, channel, crop_box)
    pix = fitz.Pixmap(fitz.csRGB, crop_box.width, crop_box.height, bytes(cropped), False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(path))
    return path


def save_mask_overlay_crop(
    pixels: bytes,
    width: int,
    height: int,
    channel: int,
    crop_box: Box,
    mask_points: set[tuple[int, int]],
    path: Path,
) -> Path:
    cropped = crop_pixels(pixels, width, height, channel, crop_box)
    local_mask = {
        (x - crop_box.x, y - crop_box.y)
        for x, y in mask_points
        if crop_box.x <= x < crop_box.x + crop_box.width and crop_box.y <= y < crop_box.y + crop_box.height
    }
    for xx, yy in local_mask:
        original = read_rgb(cropped, crop_box.width, channel, xx, yy)
        write_rgb(cropped, crop_box.width, channel, xx, yy, blend_rgb(original, (64, 220, 96), 0.58))
    pix = fitz.Pixmap(fitz.csRGB, crop_box.width, crop_box.height, bytes(cropped), False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(path))
    return path


def save_diff_crop(
    original: bytes,
    repaired: bytes,
    width: int,
    height: int,
    channel: int,
    crop_box: Box,
    path: Path,
) -> Path:
    original_crop = crop_pixels(original, width, height, channel, crop_box)
    repaired_crop = crop_pixels(repaired, width, height, channel, crop_box)
    diff = bytearray(len(original_crop))
    for yy in range(crop_box.height):
        for xx in range(crop_box.width):
            base = (yy * crop_box.width + xx) * channel
            for channel_index in range(3):
                delta = abs(original_crop[base + channel_index] - repaired_crop[base + channel_index])
                diff[base + channel_index] = min(255, delta * 4)
    pix = fitz.Pixmap(fitz.csRGB, crop_box.width, crop_box.height, bytes(diff), False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(path))
    return path


def save_residual_crop(
    repaired: bytes,
    width: int,
    height: int,
    channel: int,
    crop_box: Box,
    mask_box: Box,
    path: Path,
) -> Path:
    repaired_crop = crop_pixels(repaired, width, height, channel, crop_box)
    local_mask_box = Box(
        x=max(0, mask_box.x - crop_box.x),
        y=max(0, mask_box.y - crop_box.y),
        width=min(crop_box.width, mask_box.width),
        height=min(crop_box.height, mask_box.height),
    )
    for yy in range(local_mask_box.y, min(crop_box.height, local_mask_box.y + local_mask_box.height)):
        for xx in range(local_mask_box.x, min(crop_box.width, local_mask_box.x + local_mask_box.width)):
            gray = to_gray(*read_rgb(repaired_crop, crop_box.width, channel, xx, yy))
            if gray > 96:
                write_rgb(repaired_crop, crop_box.width, channel, xx, yy, (255, 96, 96))
            else:
                write_rgb(repaired_crop, crop_box.width, channel, xx, yy, (gray, gray, gray))
    pix = fitz.Pixmap(fitz.csRGB, crop_box.width, crop_box.height, bytes(repaired_crop), False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(path))
    return path


def save_structure_line_overlay(
    original: bytes,
    width: int,
    height: int,
    channel: int,
    crop_box: Box,
    mask_box: Box,
    path: Path,
) -> Path:
    cropped = crop_pixels(original, width, height, channel, crop_box)
    local_mask = Box(
        x=max(0, mask_box.x - crop_box.x),
        y=max(0, mask_box.y - crop_box.y),
        width=min(crop_box.width, mask_box.width),
        height=min(crop_box.height, mask_box.height),
    )
    segments = detect_structure_lines(original, width, height, channel, mask_box)
    for segment in segments:
        if segment["orientation"] == 0:
            yy = segment["position"] - crop_box.y
            if 0 <= yy < crop_box.height:
                for xx in range(local_mask.x, min(crop_box.width, local_mask.x + local_mask.width)):
                    write_rgb(cropped, crop_box.width, channel, xx, yy, (96, 180, 255))
        else:
            xx = segment["position"] - crop_box.x
            if 0 <= xx < crop_box.width:
                for yy in range(local_mask.y, min(crop_box.height, local_mask.y + local_mask.height)):
                    write_rgb(cropped, crop_box.width, channel, xx, yy, (96, 180, 255))
    pix = fitz.Pixmap(fitz.csRGB, crop_box.width, crop_box.height, bytes(cropped), False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(path))
    return path


def crop_pixels(
    pixels: bytes,
    width: int,
    height: int,
    channel: int,
    crop_box: Box,
) -> bytearray:
    cropped = bytearray(crop_box.width * crop_box.height * channel)
    for yy in range(crop_box.height):
        src_y = min(height - 1, max(0, crop_box.y + yy))
        for xx in range(crop_box.width):
            src_x = min(width - 1, max(0, crop_box.x + xx))
            src_index = (src_y * width + src_x) * channel
            dst_index = (yy * crop_box.width + xx) * channel
            for channel_index in range(channel):
                cropped[dst_index + channel_index] = pixels[src_index + channel_index]
    return cropped


def save_debug_overlay(
    source: bytes,
    width: int,
    height: int,
    channel: int,
    path: Path,
    *,
    boxes: list[tuple[Box, tuple[int, int, int]]],
    points: set[tuple[int, int]],
) -> Path:
    overlay = bytearray(source)
    for point in points:
        x, y = point
        if 0 <= x < width and 0 <= y < height:
            write_rgb(overlay, width, channel, x, y, (64, 220, 96))
    for box, color in boxes:
        draw_box(overlay, width, height, channel, box, color)
    pix = fitz.Pixmap(fitz.csRGB, width, height, bytes(overlay), False)
    path.parent.mkdir(parents=True, exist_ok=True)
    pix.save(str(path))
    return path


def draw_box(
    pixels: bytearray,
    width: int,
    height: int,
    channel: int,
    box: Box,
    color: tuple[int, int, int],
) -> None:
    x0 = max(0, min(width - 1, box.x))
    y0 = max(0, min(height - 1, box.y))
    x1 = max(0, min(width - 1, box.x + box.width - 1))
    y1 = max(0, min(height - 1, box.y + box.height - 1))
    for thickness in range(2):
        for xx in range(x0, x1 + 1):
            if y0 + thickness < height:
                write_rgb(pixels, width, channel, xx, y0 + thickness, color)
            if y1 - thickness >= 0:
                write_rgb(pixels, width, channel, xx, y1 - thickness, color)
        for yy in range(y0, y1 + 1):
            if x0 + thickness < width:
                write_rgb(pixels, width, channel, x0 + thickness, yy, color)
            if x1 - thickness >= 0:
                write_rgb(pixels, width, channel, x1 - thickness, yy, color)


def read_rgb(
    pixels: bytearray, width: int, channel: int, x: int, y: int
) -> tuple[int, int, int]:
    index = (y * width + x) * channel
    return pixels[index], pixels[index + 1], pixels[index + 2]


def write_rgb(
    pixels: bytearray, width: int, channel: int, x: int, y: int, rgb: tuple[int, int, int]
) -> None:
    index = (y * width + x) * channel
    pixels[index] = rgb[0]
    pixels[index + 1] = rgb[1]
    pixels[index + 2] = rgb[2]


def to_gray(r: int, g: int, b: int) -> int:
    return int(0.299 * r + 0.587 * g + 0.114 * b)


def median(values: list[int]) -> float:
    if not values:
        return 0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return float(ordered[mid])
    return (ordered[mid - 1] + ordered[mid]) / 2


def clamp_int(value: int, min_value: int, max_value: int) -> int:
    return min(max_value, max(min_value, value))


def union_boxes(boxes: list[Box]) -> Box:
    valid = [box for box in boxes if box.width > 0 and box.height > 0]
    if not valid:
        return Box(0, 0, 1, 1)
    min_x = min(box.x for box in valid)
    min_y = min(box.y for box in valid)
    max_x = max(box.x + box.width for box in valid)
    max_y = max(box.y + box.height for box in valid)
    return Box(min_x, min_y, max(1, max_x - min_x), max(1, max_y - min_y))


def expand_box(
    box: Box,
    width: int,
    height: int,
    left: int,
    top: int,
    right: int,
    bottom: int,
) -> Box:
    next_x = max(0, box.x - left)
    next_y = max(0, box.y - top)
    next_right = min(width, box.x + box.width + right)
    next_bottom = min(height, box.y + box.height + bottom)
    return Box(next_x, next_y, max(1, next_right - next_x), max(1, next_bottom - next_y))


def expand_box_asymmetric_anchor(
    box: Box,
    width: int,
    height: int,
    *,
    left: int,
    top: int,
    right: int,
    bottom: int,
) -> Box:
    return expand_box(box, width, height, left=left, top=top, right=right, bottom=bottom)


def ensure_min_box_ratio(
    box: Box,
    detected_box: Box,
    width: int,
    height: int,
    ratio: float,
) -> Box:
    min_width = max(1, int(detected_box.width * ratio))
    min_height = max(1, int(detected_box.height * ratio))
    next_box = box
    if next_box.width < min_width:
        deficit = min_width - next_box.width
        next_box = expand_box(
            next_box,
            width,
            height,
            left=deficit // 2 + 1,
            top=0,
            right=deficit - deficit // 2 + 1,
            bottom=0,
        )
    if next_box.height < min_height:
        deficit = min_height - next_box.height
        next_box = expand_box(
            next_box,
            width,
            height,
            left=0,
            top=deficit // 2 + 1,
            right=0,
            bottom=deficit - deficit // 2 + 1,
        )
    return next_box


def box_to_points(box: Box) -> set[tuple[int, int]]:
    return {
        (xx, yy)
        for yy in range(box.y, box.y + box.height)
        for xx in range(box.x, box.x + box.width)
    }


def box_to_json(box: Box) -> dict[str, int]:
    return {
        "x": box.x,
        "y": box.y,
        "width": box.width,
        "height": box.height,
    }


def count_reasons(skipped: list[dict[str, Any]]) -> dict[str, int]:
    result: dict[str, int] = {}
    for item in skipped:
        reason = str(item.get("reason", "unknown"))
        result[reason] = result.get(reason, 0) + 1
    return result


def build_quality_metrics(
    *,
    candidate_count: int,
    attempted_operation_count: int,
    applied_operation_count: int,
    no_instruction_removed_count: int,
) -> dict[str, Any]:
    removal_success_rate = (
        float(applied_operation_count) / float(attempted_operation_count)
        if attempted_operation_count > 0
        else 0.0
    )
    return {
        "candidateCount": candidate_count,
        "anchorCount": attempted_operation_count,
        "reliableAnchorCount": attempted_operation_count,
        "reliableAnchorRate": 1.0 if attempted_operation_count > 0 else 0.0,
        "attemptedOperationCount": attempted_operation_count,
        "appliedOperationCount": applied_operation_count,
        "noInstructionRemovedCount": no_instruction_removed_count,
        "partialHitCandidateCount": 0,
        "removalSuccessRate": round(removal_success_rate, 4),
        "vectorAttemptedOperationCount": 0,
        "vectorAppliedOperationCount": 0,
        "vectorNoInstructionRemovedCount": 0,
        "vectorRemovalSuccessRate": 0,
        "vectorSpanShapeMismatchCount": 0,
        "vectorGraphicsDepthMismatchCount": 0,
        "vectorMissingPathSegmentCount": 0,
        "vectorMissingPaintSegmentCount": 0,
        "vectorRequiredPaintOperatorMissingCount": 0,
        "vectorSignaturePrefixMismatchCount": 0,
        "vectorSignatureOperatorSequenceMismatchCount": 0,
        "vectorSignatureBBoxMismatchCount": 0,
        "vectorDeleteRemovedZeroCommandsCount": 0,
        "vectorResidualPathLeftCount": 0,
        "vectorResidualPaintLeftCount": 0,
    }


def build_metrics_comparison(previous_metrics: Any, current_metrics: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(previous_metrics, dict):
        return None
    delta: dict[str, Any] = {}
    for key, current_value in current_metrics.items():
        previous_value = previous_metrics.get(key)
        if isinstance(current_value, (int, float)) and isinstance(previous_value, (int, float)):
            delta[key] = round(float(current_value) - float(previous_value), 4)
        else:
            delta[key] = None
    return {
        "previous": previous_metrics,
        "current": current_metrics,
        "delta": delta,
    }


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())

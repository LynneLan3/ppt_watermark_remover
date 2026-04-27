#!/usr/bin/env python3
"""Batch regression runner for NotebookLM raster watermark cleanup."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run raster regression suite by PDF manifest")
    parser.add_argument("--manifest", type=Path, required=True, help="Suite manifest json path")
    parser.add_argument("--output-dir", type=Path, required=True, help="Output root directory")
    parser.add_argument("--python-bin", default=sys.executable, help="Python executable")
    parser.add_argument(
        "--process-script",
        type=Path,
        default=Path("python/process_raster_watermark_v1.py"),
        help="Raster process script path",
    )
    parser.add_argument(
        "--baseline-results",
        type=Path,
        help="Optional previous regression-suite-results.v1.json for automatic regression checks",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.manifest.exists():
        print(f"[error] manifest not found: {args.manifest}")
        return 2
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    cases = payload.get("pdfs", [])
    if not isinstance(cases, list) or not cases:
        print("[error] manifest.pdfs is empty")
        return 3

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    cases_output: list[dict[str, Any]] = []

    for row in cases:
        if not isinstance(row, dict):
            continue
        case_id = str(row.get("id") or "")
        pdf_path = resolve_pdf_path(args.manifest.parent, row.get("pdfPath"))
        if not case_id:
            continue
        case_output_dir = output_dir / case_id
        case_output_dir.mkdir(parents=True, exist_ok=True)
        if not pdf_path or not pdf_path.exists():
            cases_output.append(
                {
                    "id": case_id,
                    "label": str(row.get("label", case_id)),
                    "category": str(row.get("category", "unknown")),
                    "suiteRole": str(row.get("suiteRole", "light_complex_regression")),
                    "pdfPath": str(pdf_path) if pdf_path else "",
                    "status": "missing_pdf",
                }
            )
            continue

        request_path = case_output_dir / "process-request.v2.json"
        report_path = case_output_dir / "process-report.json"
        output_pdf_path = case_output_dir / "processed.pdf"
        process_debug_path = case_output_dir / "process-debug.v1.json"
        request_payload = {
            "rasterProcessConfig": {
                "roi": {"widthRatio": 0.16, "heightRatio": 0.08},
                "renderScale": 2.5,
                "watermarkRegionHint": "right_bottom",
            },
            "processDebugPath": str(process_debug_path),
            "selection": [],
            "previousMetrics": None,
        }
        request_path.write_text(json.dumps(request_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        command = [
            args.python_bin,
            str(args.process_script),
            "--request",
            str(request_path),
            "--input",
            str(pdf_path),
            "--output",
            str(output_pdf_path),
            "--report",
            str(report_path),
        ]
        run = subprocess.run(command, capture_output=True, text=True)
        if run.returncode != 0 or not report_path.exists():
            cases_output.append(
                {
                    "id": case_id,
                    "label": str(row.get("label", case_id)),
                    "category": str(row.get("category", "unknown")),
                    "suiteRole": str(row.get("suiteRole", "light_complex_regression")),
                    "pdfPath": str(pdf_path),
                    "status": "process_failed",
                    "stderr": run.stderr[-2000:],
                    "stdout": run.stdout[-1200:],
                }
            )
            continue
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if args.baseline_results and args.baseline_results.exists():
            enrich_report_with_v5_pass_regressions(report, case_id, args.baseline_results.parent)
            report_path.write_text(
                json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True),
                encoding="utf-8",
            )
        cases_output.append(build_case_summary(row, pdf_path, report))

    summary = build_suite_summary(cases_output)
    baseline_payload = None
    if args.baseline_results and args.baseline_results.exists():
        baseline_payload = json.loads(args.baseline_results.read_text(encoding="utf-8"))
    if args.baseline_results and args.baseline_results.exists():
        add_pass_regression_counts(summary, output_dir, args.baseline_results.parent)
    comparisons = build_summary_comparisons(summary, baseline_payload.get("summary") if isinstance(baseline_payload, dict) else None)
    result_payload = {
        "generatedAt": iso_now(),
        "manifestPath": str(args.manifest),
        "outputDir": str(output_dir),
        "cases": cases_output,
        "summary": summary,
        "comparisons": comparisons,
    }
    result_json = output_dir / "regression-suite-results.v1.json"
    result_json.write_text(json.dumps(result_payload, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    result_md = output_dir / "regression-suite-summary.v1.md"
    result_md.write_text(build_summary_markdown(result_payload), encoding="utf-8")
    print(f"[ok] results: {result_json}")
    print(f"[ok] markdown: {result_md}")
    return 0


def enrich_report_with_v5_pass_regressions(report: dict[str, Any], case_id: str, baseline_run_dir: Path) -> int:
    """Match each page to v5 `process-report.json` in baseline_run_dir and set v5 pass-regression fields."""
    br = baseline_run_dir / case_id / "process-report.json"
    if not br.exists():
        for row in report.get("perPageResults", []):
            if isinstance(row, dict):
                row["v5PassedBecameFailedCount"] = 0
                row["v5PassBecameFailed"] = False
        report["v5PassedBecameFailedCount"] = 0
        return 0
    try:
        prev = json.loads(br.read_text(encoding="utf-8"))
    except Exception:  # pylint: disable=broad-except
        report["v5PassedBecameFailedCount"] = 0
        return 0
    bmap: dict[int, dict[str, Any]] = {
        int(r["page"]): r
        for r in prev.get("perPageResults", [])
        if isinstance(r, dict) and isinstance(r.get("page"), int)
    }
    total = 0
    for row in report.get("perPageResults", []):
        if not isinstance(row, dict):
            continue
        p = int(row.get("page", 0))
        b = bmap.get(p)
        v5_ok = bool(b.get("success")) if b else False
        v6_ok = bool(row.get("success"))
        reg = 1 if (v5_ok and not v6_ok) else 0
        row["v5PassBecameFailed"] = bool(reg)
        row["v5PassedBecameFailedCount"] = reg
        total += reg
    report["v5PassedBecameFailedCount"] = total
    return total


def resolve_pdf_path(base_dir: Path, value: Any) -> Path | None:
    if not isinstance(value, str) or not value.strip():
        return None
    path = Path(value)
    if path.is_absolute():
        return path
    return (base_dir / path).resolve()


def build_case_summary(meta: dict[str, Any], pdf_path: Path, report: dict[str, Any]) -> dict[str, Any]:
    pages = [row for row in report.get("perPageResults", []) if isinstance(row, dict)]
    passed_pages = [row for row in pages if bool(row.get("success"))]
    failed_pages = [row for row in pages if not bool(row.get("success"))]
    page_style_counts = count_values(pages, "pageStyleClass")
    dominant_detected_style = "unknown"
    if page_style_counts:
        dominant_detected_style = max(page_style_counts.items(), key=lambda item: item[1])[0]
    style_summaries: dict[str, dict[str, float | int]] = {}
    for style in (
        "dark_plain",
        "dark_glow_panel",
        "light_plain",
        "light_gridline",
        "light_gradient",
        "light_complex_diagram",
        "mixed_structure",
    ):
        style_rows = [row for row in pages if str(row.get("pageStyleClass", "")) == style]
        if style_rows:
            style_summaries[style] = summarize_pages(style_rows)
    return {
        "id": str(meta.get("id", "")),
        "label": str(meta.get("label") or meta.get("id") or ""),
        "category": str(meta.get("category", "unknown")),
        "suiteRole": str(meta.get("suiteRole", "light_complex_regression")),
        "pdfPath": str(pdf_path),
        "status": "ok",
        "totalPages": int(report.get("processedPageCount", len(pages))),
        "repairedPages": int(report.get("repairedPageCount", len(passed_pages))),
        "passedPages": len(passed_pages),
        "failedPages": len(failed_pages),
        "avgResidualWatermarkScore": mean_metric(pages, "residualWatermarkScore"),
        "avgDamageTextureDelta": mean_metric(pages, "damageTextureDelta"),
        "avgSeamScore": mean_metric(pages, "damageSeamScore"),
        "avgBrightnessDelta": mean_metric(pages, "brightnessDelta", fallback_key="damageLumaDelta"),
        "pageStyleCounts": page_style_counts,
        "dominantDetectedStyle": dominant_detected_style,
        "failureCategoryCounts": count_values(failed_pages, "failureCategory", default="watermark removal insufficient"),
        "failedReasonCounts": report.get("failedReasonCounts", {}),
        "styleSummaries": style_summaries,
    }


def summarize_pages(rows: list[dict[str, Any]]) -> dict[str, float | int]:
    passed_rows = [row for row in rows if bool(row.get("success"))]
    failed_rows = [row for row in rows if not bool(row.get("success"))]
    failure_category_counts = count_values(failed_rows, "failureCategory", default="watermark removal insufficient")
    return {
        "totalPages": len(rows),
        "passedPages": len(passed_rows),
        "failedPages": len(failed_rows),
        "watermarkRemovalInsufficient": int(failure_category_counts.get("watermark removal insufficient", 0)),
        "damageTooHigh": int(failure_category_counts.get("damage too high", 0)),
        "avgResidualWatermarkScore": mean_metric(rows, "residualWatermarkScore"),
        "avgDamageTextureDelta": mean_metric(rows, "damageTextureDelta"),
        "avgSeamScore": mean_metric(rows, "damageSeamScore"),
        "avgSeam": mean_metric(rows, "damageSeamScore"),
        "avgBrightnessDelta": mean_metric(rows, "brightnessDelta", fallback_key="damageLumaDelta"),
        "avgTrailingSeamBefore": mean_metric(rows, "trailingSeamBefore", nonzero_only=True),
        "avgTrailingSeamAfter": mean_metric(rows, "trailingSeamAfter", nonzero_only=True),
        "avgTrailingBrightnessBefore": mean_metric(rows, "trailingBrightnessBefore", nonzero_only=True),
        "avgTrailingBrightnessAfter": mean_metric(rows, "trailingBrightnessAfter", nonzero_only=True),
        "seamGuardTriggeredCount": count_true(rows, "seamGuardTriggered"),
        "brightnessGuardTriggeredCount": count_true(rows, "brightnessGuardTriggered"),
        "structureProtectionTriggeredCount": count_true(rows, "structureProtectionTriggered"),
        "seamRingAppliedCount": count_true(rows, "seamRingApplied"),
        "seamRingAcceptedCount": count_true(rows, "seamRingAccepted"),
        "seamRingRollbackCount": count_false_after_apply(rows, "seamRingApplied", "seamRingAccepted"),
        "avgSeamRingBefore": mean_metric(rows, "seamRingSeamBefore", nonzero_only=True),
        "avgSeamRingAfter": mean_metric(rows, "seamRingSeamAfter", nonzero_only=True),
        "avgBrightnessRingBefore": mean_metric(rows, "seamRingBrightnessBefore", nonzero_only=True),
        "avgBrightnessRingAfter": mean_metric(rows, "seamRingBrightnessAfter", nonzero_only=True),
        "passPreservingRollbackCount": count_true(rows, "passPreservingRollbackTriggered"),
        "v4PassedBecameFailedCount": 0,
        "seamMicroPolishAttemptedCount": count_true(rows, "seamMicroPolishAttempted"),
        "seamMicroPolishAcceptedCount": count_true(rows, "seamMicroPolishAccepted"),
        "seamMicroPolishRollbackCount": count_false_after_apply(
            rows, "seamMicroPolishAttempted", "seamMicroPolishAccepted"
        ),
        "avgSeamMicroBefore": mean_metric(rows, "seamMicroPolishSeamBefore", nonzero_only=True),
        "avgSeamMicroAfter": mean_metric(rows, "seamMicroPolishSeamAfter", nonzero_only=True),
        "avgBrightnessMicroBefore": mean_metric(rows, "seamMicroPolishBrightnessBefore", nonzero_only=True),
        "avgBrightnessMicroAfter": mean_metric(rows, "seamMicroPolishBrightnessAfter", nonzero_only=True),
        "v5PassedBecameFailedCount": sum(
            int(row.get("v5PassedBecameFailedCount") or 0) for row in rows
        ),
    }


def mean_metric(
    rows: list[dict[str, Any]],
    key: str,
    *,
    fallback_key: str | None = None,
    nonzero_only: bool = False,
) -> float:
    values: list[float] = []
    for row in rows:
        value = row.get(key)
        if value is None and fallback_key:
            value = row.get(fallback_key)
        if isinstance(value, (int, float)):
            if nonzero_only and float(value) == 0.0:
                continue
            values.append(float(value))
    if not values:
        return 0.0
    return round(sum(values) / len(values), 6)


def count_values(rows: list[dict[str, Any]], key: str, *, default: str = "unknown") -> dict[str, int]:
    counter: Counter[str] = Counter()
    for row in rows:
        value = row.get(key)
        if not isinstance(value, str) or not value:
            value = default
        counter[value] += 1
    return dict(counter)


def count_true(rows: list[dict[str, Any]], key: str) -> int:
    return sum(1 for row in rows if bool(row.get(key)))


def count_false_after_apply(rows: list[dict[str, Any]], applied_key: str, accepted_key: str) -> int:
    return sum(1 for row in rows if bool(row.get(applied_key)) and not bool(row.get(accepted_key)))


def build_suite_summary(cases: list[dict[str, Any]]) -> dict[str, Any]:
    executed = [row for row in cases if row.get("status") == "ok"]
    missing = [row for row in cases if row.get("status") == "missing_pdf"]
    failed = [row for row in cases if row.get("status") == "process_failed"]
    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in executed:
        by_category[str(row.get("category", "unknown"))].append(row)
    category_summary: list[dict[str, Any]] = []
    for category, rows in sorted(by_category.items()):
        category_summary.append(
            {
                "category": category,
                "pdfCount": len(rows),
                "totalPages": sum(int(row.get("totalPages", 0)) for row in rows),
                "repairedPages": sum(int(row.get("repairedPages", 0)) for row in rows),
                "passedPages": sum(int(row.get("passedPages", 0)) for row in rows),
                "failedPages": sum(int(row.get("failedPages", 0)) for row in rows),
                "avgResidualWatermarkScore": round(
                    sum(float(row.get("avgResidualWatermarkScore", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
                "avgDamageTextureDelta": round(
                    sum(float(row.get("avgDamageTextureDelta", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
                "avgSeamScore": round(
                    sum(float(row.get("avgSeamScore", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
                "avgBrightnessDelta": round(
                    sum(float(row.get("avgBrightnessDelta", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
            }
        )
    by_detected_style: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in executed:
        by_detected_style[str(row.get("dominantDetectedStyle", "unknown"))].append(row)
    detected_style_summary: list[dict[str, Any]] = []
    for style, rows in sorted(by_detected_style.items()):
        detected_style_summary.append(
            {
                "detectedStyle": style,
                "pdfCount": len(rows),
                "totalPages": sum(int(row.get("totalPages", 0)) for row in rows),
                "passedPages": sum(int(row.get("passedPages", 0)) for row in rows),
                "failedPages": sum(int(row.get("failedPages", 0)) for row in rows),
                "avgResidualWatermarkScore": round(
                    sum(float(row.get("avgResidualWatermarkScore", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
                "avgDamageTextureDelta": round(
                    sum(float(row.get("avgDamageTextureDelta", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
                "avgSeamScore": round(
                    sum(float(row.get("avgSeamScore", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
                "avgBrightnessDelta": round(
                    sum(float(row.get("avgBrightnessDelta", 0.0)) for row in rows) / max(1, len(rows)),
                    6,
                ),
            }
        )

    dark_rows = [row for row in executed if str(row.get("suiteRole")) == "dark_baseline"]
    dark_baseline_stable = None if not dark_rows else all(int(row.get("failedPages", 0)) == 0 for row in dark_rows)
    failure_categories = Counter()
    for row in executed:
        for category, count in row.get("failureCategoryCounts", {}).items():
            failure_categories[str(category)] += int(count)
    full_pages = aggregate_style_pages(executed, style_filter=None)
    dark_baseline_pages = aggregate_style_pages(executed, style_filter={"dark_plain", "dark_glow_panel"})
    light_plain_pages = aggregate_style_pages(executed, style_filter={"light_plain"})
    light_complex_pages = aggregate_style_pages(executed, style_filter={"light_complex_diagram"})
    dark_baseline_stable_by_pages = bool(
        dark_baseline_pages.get("totalPages", 0) > 0 and dark_baseline_pages.get("failedPages", 0) <= 0
    )
    return {
        "totalPdfCases": len(cases),
        "executedPdfCases": len(executed),
        "missingPdfCases": len(missing),
        "processFailedCases": len(failed),
        "categorySummary": category_summary,
        "detectedStyleSummary": detected_style_summary,
        "darkBaselineStable": dark_baseline_stable,
        "darkBaselineStableByPages": dark_baseline_stable_by_pages,
        "failureCategoryTotals": dict(failure_categories),
        "fullSummary": full_pages,
        "darkBaselineSummary": dark_baseline_pages,
        "lightPlainSummary": light_plain_pages,
        "lightComplexDiagramSummary": light_complex_pages,
        "avgTrailingSeamBefore": full_pages.get("avgTrailingSeamBefore", 0.0),
        "avgTrailingSeamAfter": full_pages.get("avgTrailingSeamAfter", 0.0),
        "avgTrailingBrightnessBefore": full_pages.get("avgTrailingBrightnessBefore", 0.0),
        "avgTrailingBrightnessAfter": full_pages.get("avgTrailingBrightnessAfter", 0.0),
        "seamGuardTriggeredCount": full_pages.get("seamGuardTriggeredCount", 0),
        "brightnessGuardTriggeredCount": full_pages.get("brightnessGuardTriggeredCount", 0),
        "structureProtectionTriggeredCount": full_pages.get("structureProtectionTriggeredCount", 0),
        "seamRingAppliedCount": full_pages.get("seamRingAppliedCount", 0),
        "seamRingAcceptedCount": full_pages.get("seamRingAcceptedCount", 0),
        "seamRingRollbackCount": full_pages.get("seamRingRollbackCount", 0),
        "avgSeamRingBefore": full_pages.get("avgSeamRingBefore", 0.0),
        "avgSeamRingAfter": full_pages.get("avgSeamRingAfter", 0.0),
        "avgBrightnessRingBefore": full_pages.get("avgBrightnessRingBefore", 0.0),
        "avgBrightnessRingAfter": full_pages.get("avgBrightnessRingAfter", 0.0),
        "passPreservingRollbackCount": full_pages.get("passPreservingRollbackCount", 0),
        "v4PassedBecameFailedCount": full_pages.get("v4PassedBecameFailedCount", 0),
        "v5PassedBecameFailedCount": full_pages.get("v5PassedBecameFailedCount", 0),
        "seamMicroPolishAttemptedCount": full_pages.get("seamMicroPolishAttemptedCount", 0),
        "seamMicroPolishAcceptedCount": full_pages.get("seamMicroPolishAcceptedCount", 0),
        "seamMicroPolishRollbackCount": full_pages.get("seamMicroPolishRollbackCount", 0),
        "avgSeamMicroBefore": full_pages.get("avgSeamMicroBefore", 0.0),
        "avgSeamMicroAfter": full_pages.get("avgSeamMicroAfter", 0.0),
        "avgBrightnessMicroBefore": full_pages.get("avgBrightnessMicroBefore", 0.0),
        "avgBrightnessMicroAfter": full_pages.get("avgBrightnessMicroAfter", 0.0),
    }


def build_summary_comparisons(
    current_summary: dict[str, Any], baseline_summary: dict[str, Any] | None
) -> dict[str, Any]:
    if not baseline_summary:
        return {"hasBaseline": False}
    current_dark = current_summary.get("darkBaselineSummary", {})
    baseline_dark = baseline_summary.get("darkBaselineSummary", {})
    current_light_complex = current_summary.get("lightComplexDiagramSummary", {})
    baseline_light_complex = baseline_summary.get("lightComplexDiagramSummary", {})
    current_light_plain = current_summary.get("lightPlainSummary", {})
    baseline_light_plain = baseline_summary.get("lightPlainSummary", {})
    dark_regressed = detect_dark_regression(current_dark, baseline_dark)
    return {
        "hasBaseline": True,
        "darkBaselineRegressed": dark_regressed,
        "darkBaselineDelta": metric_delta(current_dark, baseline_dark),
        "lightComplexDelta": metric_delta(current_light_complex, baseline_light_complex),
        "lightPlainDelta": metric_delta(current_light_plain, baseline_light_plain),
    }


def detect_dark_regression(current_dark: dict[str, Any], baseline_dark: dict[str, Any]) -> bool:
    if not current_dark or not baseline_dark:
        return False
    if int(current_dark.get("passedPages", 0)) < int(baseline_dark.get("passedPages", 0)):
        return True
    if int(current_dark.get("failedPages", 0)) > int(baseline_dark.get("failedPages", 0)):
        return True
    if float(current_dark.get("avgResidualWatermarkScore", 0.0)) > float(
        baseline_dark.get("avgResidualWatermarkScore", 0.0)
    ) + 0.01:
        return True
    if float(current_dark.get("avgSeamScore", 0.0)) > float(baseline_dark.get("avgSeamScore", 0.0)) + 0.01:
        return True
    return False


def metric_delta(current: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float | int]:
    keys = (
        "totalPages",
        "passedPages",
        "failedPages",
        "avgResidualWatermarkScore",
        "avgDamageTextureDelta",
        "avgSeamScore",
        "avgBrightnessDelta",
        "avgTrailingSeamBefore",
        "avgTrailingSeamAfter",
        "avgTrailingBrightnessBefore",
        "avgTrailingBrightnessAfter",
        "seamGuardTriggeredCount",
        "brightnessGuardTriggeredCount",
        "structureProtectionTriggeredCount",
        "seamRingAppliedCount",
        "seamRingAcceptedCount",
        "seamRingRollbackCount",
        "avgSeamRingBefore",
        "avgSeamRingAfter",
        "avgBrightnessRingBefore",
        "avgBrightnessRingAfter",
        "passPreservingRollbackCount",
        "v4PassedBecameFailedCount",
        "v5PassedBecameFailedCount",
        "seamMicroPolishAttemptedCount",
        "seamMicroPolishAcceptedCount",
        "seamMicroPolishRollbackCount",
        "avgSeamMicroBefore",
        "avgSeamMicroAfter",
        "avgBrightnessMicroBefore",
        "avgBrightnessMicroAfter",
    )
    delta: dict[str, float | int] = {}
    for key in keys:
        base = baseline.get(key, 0)
        now = current.get(key, 0)
        if isinstance(base, int) and isinstance(now, int):
            delta[key] = now - base
        else:
            delta[key] = round(float(now) - float(base), 6)
    return delta


def aggregate_style_pages(
    executed_cases: list[dict[str, Any]], *, style_filter: set[str] | None
) -> dict[str, float | int]:
    total_pages = 0
    passed_pages = 0
    failed_pages = 0
    residual_values: list[float] = []
    damage_texture_values: list[float] = []
    seam_values: list[float] = []
    brightness_values: list[float] = []
    trailing_seam_before_values: list[float] = []
    trailing_seam_after_values: list[float] = []
    trailing_brightness_before_values: list[float] = []
    trailing_brightness_after_values: list[float] = []
    seam_guard_triggered_count = 0
    brightness_guard_triggered_count = 0
    structure_protection_triggered_count = 0
    seam_ring_applied_count = 0
    seam_ring_accepted_count = 0
    seam_ring_rollback_count = 0
    seam_ring_before_values: list[float] = []
    seam_ring_after_values: list[float] = []
    brightness_ring_before_values: list[float] = []
    brightness_ring_after_values: list[float] = []
    micro_attempted = 0
    micro_accepted = 0
    micro_rollback = 0
    seam_micro_before: list[float] = []
    seam_micro_after: list[float] = []
    brightness_micro_before: list[float] = []
    brightness_micro_after: list[float] = []
    v5_passed_became_failed = 0
    pass_preserving_rollback_count = 0
    v4_passed_became_failed_count = 0
    watermark_removal_insufficient = 0
    damage_too_high = 0
    for case in executed_cases:
        style_summaries = case.get("styleSummaries", {})
        if not isinstance(style_summaries, dict):
            continue
        for style, summary in style_summaries.items():
            if style_filter is not None and style not in style_filter:
                continue
            if not isinstance(summary, dict):
                continue
            total_pages += int(summary.get("totalPages", 0))
            passed_pages += int(summary.get("passedPages", 0))
            failed_pages += int(summary.get("failedPages", 0))
            watermark_removal_insufficient += int(summary.get("watermarkRemovalInsufficient", 0))
            damage_too_high += int(summary.get("damageTooHigh", 0))
            residual_values.append(float(summary.get("avgResidualWatermarkScore", 0.0)))
            damage_texture_values.append(float(summary.get("avgDamageTextureDelta", 0.0)))
            seam_values.append(float(summary.get("avgSeamScore", 0.0)))
            brightness_values.append(float(summary.get("avgBrightnessDelta", 0.0)))
            if float(summary.get("avgTrailingSeamBefore", 0.0)) > 0.0:
                trailing_seam_before_values.append(float(summary.get("avgTrailingSeamBefore", 0.0)))
            if float(summary.get("avgTrailingSeamAfter", 0.0)) > 0.0:
                trailing_seam_after_values.append(float(summary.get("avgTrailingSeamAfter", 0.0)))
            if float(summary.get("avgTrailingBrightnessBefore", 0.0)) > 0.0:
                trailing_brightness_before_values.append(float(summary.get("avgTrailingBrightnessBefore", 0.0)))
            if float(summary.get("avgTrailingBrightnessAfter", 0.0)) > 0.0:
                trailing_brightness_after_values.append(float(summary.get("avgTrailingBrightnessAfter", 0.0)))
            seam_guard_triggered_count += int(summary.get("seamGuardTriggeredCount", 0))
            brightness_guard_triggered_count += int(summary.get("brightnessGuardTriggeredCount", 0))
            structure_protection_triggered_count += int(summary.get("structureProtectionTriggeredCount", 0))
            seam_ring_applied_count += int(summary.get("seamRingAppliedCount", 0))
            seam_ring_accepted_count += int(summary.get("seamRingAcceptedCount", 0))
            seam_ring_rollback_count += int(summary.get("seamRingRollbackCount", 0))
            if float(summary.get("avgSeamRingBefore", 0.0)) > 0.0:
                seam_ring_before_values.append(float(summary.get("avgSeamRingBefore", 0.0)))
            if float(summary.get("avgSeamRingAfter", 0.0)) > 0.0:
                seam_ring_after_values.append(float(summary.get("avgSeamRingAfter", 0.0)))
            if float(summary.get("avgBrightnessRingBefore", 0.0)) > 0.0:
                brightness_ring_before_values.append(float(summary.get("avgBrightnessRingBefore", 0.0)))
            if float(summary.get("avgBrightnessRingAfter", 0.0)) > 0.0:
                brightness_ring_after_values.append(float(summary.get("avgBrightnessRingAfter", 0.0)))
            pass_preserving_rollback_count += int(summary.get("passPreservingRollbackCount", 0))
            v4_passed_became_failed_count += int(summary.get("v4PassedBecameFailedCount", 0))
            micro_attempted += int(summary.get("seamMicroPolishAttemptedCount", 0))
            micro_accepted += int(summary.get("seamMicroPolishAcceptedCount", 0))
            micro_rollback += int(summary.get("seamMicroPolishRollbackCount", 0))
            if float(summary.get("avgSeamMicroBefore", 0.0)) > 0.0:
                seam_micro_before.append(float(summary.get("avgSeamMicroBefore", 0.0)))
            if float(summary.get("avgSeamMicroAfter", 0.0)) > 0.0:
                seam_micro_after.append(float(summary.get("avgSeamMicroAfter", 0.0)))
            if float(summary.get("avgBrightnessMicroBefore", 0.0)) > 0.0:
                brightness_micro_before.append(float(summary.get("avgBrightnessMicroBefore", 0.0)))
            if float(summary.get("avgBrightnessMicroAfter", 0.0)) > 0.0:
                brightness_micro_after.append(float(summary.get("avgBrightnessMicroAfter", 0.0)))
            v5_passed_became_failed += int(summary.get("v5PassedBecameFailedCount", 0))
    return {
        "totalPages": total_pages,
        "passedPages": passed_pages,
        "failedPages": failed_pages,
        "watermarkRemovalInsufficient": watermark_removal_insufficient,
        "damageTooHigh": damage_too_high,
        "avgResidualWatermarkScore": round(sum(residual_values) / max(1, len(residual_values)), 6),
        "avgDamageTextureDelta": round(sum(damage_texture_values) / max(1, len(damage_texture_values)), 6),
        "avgSeamScore": round(sum(seam_values) / max(1, len(seam_values)), 6),
        "avgSeam": round(sum(seam_values) / max(1, len(seam_values)), 6),
        "avgBrightnessDelta": round(sum(brightness_values) / max(1, len(brightness_values)), 6),
        "avgTrailingSeamBefore": round(sum(trailing_seam_before_values) / max(1, len(trailing_seam_before_values)), 6),
        "avgTrailingSeamAfter": round(sum(trailing_seam_after_values) / max(1, len(trailing_seam_after_values)), 6),
        "avgTrailingBrightnessBefore": round(
            sum(trailing_brightness_before_values) / max(1, len(trailing_brightness_before_values)), 6
        ),
        "avgTrailingBrightnessAfter": round(
            sum(trailing_brightness_after_values) / max(1, len(trailing_brightness_after_values)), 6
        ),
        "seamGuardTriggeredCount": seam_guard_triggered_count,
        "brightnessGuardTriggeredCount": brightness_guard_triggered_count,
        "structureProtectionTriggeredCount": structure_protection_triggered_count,
        "seamRingAppliedCount": seam_ring_applied_count,
        "seamRingAcceptedCount": seam_ring_accepted_count,
        "seamRingRollbackCount": seam_ring_rollback_count,
        "avgSeamRingBefore": round(sum(seam_ring_before_values) / max(1, len(seam_ring_before_values)), 6),
        "avgSeamRingAfter": round(sum(seam_ring_after_values) / max(1, len(seam_ring_after_values)), 6),
        "avgBrightnessRingBefore": round(
            sum(brightness_ring_before_values) / max(1, len(brightness_ring_before_values)), 6
        ),
        "avgBrightnessRingAfter": round(
            sum(brightness_ring_after_values) / max(1, len(brightness_ring_after_values)), 6
        ),
        "passPreservingRollbackCount": pass_preserving_rollback_count,
        "v4PassedBecameFailedCount": v4_passed_became_failed_count,
        "seamMicroPolishAttemptedCount": micro_attempted,
        "seamMicroPolishAcceptedCount": micro_accepted,
        "seamMicroPolishRollbackCount": micro_rollback,
        "avgSeamMicroBefore": round(sum(seam_micro_before) / max(1, len(seam_micro_before)), 6),
        "avgSeamMicroAfter": round(sum(seam_micro_after) / max(1, len(seam_micro_after)), 6),
        "avgBrightnessMicroBefore": round(
            sum(brightness_micro_before) / max(1, len(brightness_micro_before)), 6
        ),
        "avgBrightnessMicroAfter": round(
            sum(brightness_micro_after) / max(1, len(brightness_micro_after)), 6
        ),
        "v5PassedBecameFailedCount": v5_passed_became_failed,
    }


def add_pass_regression_counts(summary: dict[str, Any], current_output_dir: Path, baseline_output_dir: Path) -> None:
    baseline_pages = load_report_pages_by_case(baseline_output_dir)
    current_pages = load_report_pages_by_case(current_output_dir)
    by_style: Counter[str] = Counter()
    total = 0
    for key, baseline_page in baseline_pages.items():
        current_page = current_pages.get(key)
        if not current_page:
            continue
        if bool(baseline_page.get("success")) and not bool(current_page.get("success")):
            style = str(current_page.get("pageStyleClass") or baseline_page.get("pageStyleClass") or "unknown")
            by_style[style] += 1
            total += 1
    summary["v4PassedBecameFailedCount"] = total
    summary["v5PassedBecameFailedCount"] = total
    for summary_key, styles in (
        ("fullSummary", None),
        ("darkBaselineSummary", {"dark_plain", "dark_glow_panel"}),
        ("lightPlainSummary", {"light_plain"}),
        ("lightComplexDiagramSummary", {"light_complex_diagram"}),
    ):
        row = summary.get(summary_key)
        if not isinstance(row, dict):
            continue
        if styles is None:
            row["v4PassedBecameFailedCount"] = total
            row["v5PassedBecameFailedCount"] = total
        else:
            row["v4PassedBecameFailedCount"] = sum(by_style.get(style, 0) for style in styles)
            row["v5PassedBecameFailedCount"] = sum(by_style.get(style, 0) for style in styles)


def load_report_pages_by_case(output_dir: Path) -> dict[tuple[str, int], dict[str, Any]]:
    pages: dict[tuple[str, int], dict[str, Any]] = {}
    for report_path in output_dir.glob("*/process-report.json"):
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except Exception:  # pylint: disable=broad-except
            continue
        for row in report.get("perPageResults", []):
            if isinstance(row, dict) and isinstance(row.get("page"), int):
                pages[(report_path.parent.name, int(row["page"]))] = row
    return pages


def build_summary_markdown(payload: dict[str, Any]) -> str:
    summary = payload.get("summary", {})
    lines = [
        "# Raster Regression Suite Summary",
        "",
        f"- generatedAt: {payload.get('generatedAt', '')}",
        f"- manifestPath: {payload.get('manifestPath', '')}",
        f"- executedPdfCases: {summary.get('executedPdfCases', 0)} / {summary.get('totalPdfCases', 0)}",
        f"- darkBaselineStable: {summary.get('darkBaselineStable', None)}",
        f"- darkBaselineStableByPages: {summary.get('darkBaselineStableByPages', None)}",
        "",
        "## Required Summaries",
        "",
        f"- dark baseline: {summary.get('darkBaselineSummary', {})}",
        f"- light plain: {summary.get('lightPlainSummary', {})}",
        f"- light complex diagram: {summary.get('lightComplexDiagramSummary', {})}",
        f"- full: {summary.get('fullSummary', {})}",
        "",
        "## Baseline Comparison",
        "",
        f"- comparisons: {payload.get('comparisons', {})}",
        "",
        "## Per PDF",
        "",
        "| id | category | total pages | repaired pages | passed pages | failed pages | avg residual | avg damage texture | avg seam | avg brightness delta |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in payload.get("cases", []):
        if row.get("status") != "ok":
            lines.append(
                f"| {row.get('id','')} | {row.get('category','')} | - | - | - | - | - | - | - | - |"
            )
            continue
        lines.append(
            "| {id} | {category} | {totalPages} | {repairedPages} | {passedPages} | {failedPages} | {avgResidualWatermarkScore:.6f} | {avgDamageTextureDelta:.6f} | {avgSeamScore:.6f} | {avgBrightnessDelta:.6f} |".format(
                **row
            )
        )
    lines.extend(
        [
            "",
            "## Category Summary",
            "",
            "| category | pdf count | total pages | passed pages | failed pages | avg residual | avg damage texture | avg seam | avg brightness delta |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for row in summary.get("categorySummary", []):
        lines.append(
            "| {category} | {pdfCount} | {totalPages} | {passedPages} | {failedPages} | {avgResidualWatermarkScore:.6f} | {avgDamageTextureDelta:.6f} | {avgSeamScore:.6f} | {avgBrightnessDelta:.6f} |".format(
                **row
            )
        )
    lines.extend(
        [
            "",
            "## Detected Style Summary",
            "",
            "| detected style | pdf count | total pages | passed pages | failed pages | avg residual | avg damage texture | avg seam | avg brightness delta |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
        ]
    )
    for row in summary.get("detectedStyleSummary", []):
        lines.append(
            "| {detectedStyle} | {pdfCount} | {totalPages} | {passedPages} | {failedPages} | {avgResidualWatermarkScore:.6f} | {avgDamageTextureDelta:.6f} | {avgSeamScore:.6f} | {avgBrightnessDelta:.6f} |".format(
                **row
            )
        )
    lines.append("")
    return "\n".join(lines)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())

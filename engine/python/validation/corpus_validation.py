"""Corpus validation workflow for Gamma/NotebookLM target PDFs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
import argparse
import csv
import json
from pathlib import Path
from collections import Counter
from typing import Any

from editing.object_remover import RemovalError, apply_removal_plan
from parsers.pdf_objects import analysis_result_to_dict, analyze_pdf_candidates

SUPPORTED_SOURCE_TYPES = ("gamma", "notebooklm", "other")
SUPPORTED_MODES = ("analyze-only", "analyze-apply")

# TODO(engine-targeted-improvements):
# Keep this mapping updated after each real corpus baseline run so follow-up rounds can
# translate dominant reason codes into specific parser/grouping/object-remover tasks.
FUTURE_REASON_WORK_HINTS: dict[str, str] = {
    "large_background_image": "Prioritize detection of non-background repeated overlays in mixed pages.",
    "likely_background_baked": "Investigate baked-background detection and safe fail-fast clarity.",
    "non_repeated_decorative_image": "Expand repeat matching tolerance only when false positive risk stays low.",
    "unsupported_structure": "Inspect source-specific patterns (Gamma/NotebookLM) that still miss stable grouping.",
}


@dataclass(frozen=True)
class ValidationFileResult:
    source_type: str
    filename: str
    pages: int
    candidate_count: int
    supported_candidate_count: int
    unsupported_candidate_count: int
    target_logo_footer_header_found: bool
    cleaned_output_produced: bool
    usable: bool
    unsupported_reason_codes: list[str]
    selected_candidate_id: str | None
    selected_candidate_type: str | None
    selected_candidate_reason_code: str | None
    failure_reason: str | None
    supported_reason_codes: list[str]
    apply_attempted: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "sourceType": self.source_type,
            "filename": self.filename,
            "pages": self.pages,
            "candidateCount": self.candidate_count,
            "supportedCandidateCount": self.supported_candidate_count,
            "unsupportedCandidateCount": self.unsupported_candidate_count,
            "targetLogoFooterHeaderFound": self.target_logo_footer_header_found,
            "cleanedOutputProduced": self.cleaned_output_produced,
            "usable": self.usable,
            "unsupportedReasonCodes": self.unsupported_reason_codes,
            "selectedCandidateId": self.selected_candidate_id,
            "selectedCandidateType": self.selected_candidate_type,
            "selectedCandidateReasonCode": self.selected_candidate_reason_code,
            "failureReason": self.failure_reason,
            "supportedReasonCodes": self.supported_reason_codes,
            "applyAttempted": self.apply_attempted,
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="gamma-notebooklm-corpus-validation",
        description=(
            "Run analyze/apply validation on a local sample corpus and export a quality summary."
        ),
    )
    parser.add_argument(
        "--samples-root",
        type=Path,
        required=True,
        help=(
            "Directory containing source-type folders, e.g. "
            "<root>/gamma/*.pdf, <root>/notebooklm/*.pdf, <root>/other/*.pdf."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="(Legacy) Summary JSON output path. Prefer --output-prefix.",
    )
    parser.add_argument(
        "--output-prefix",
        type=Path,
        default=Path("temp/validation/gamma-notebooklm-summary"),
        help="Output prefix used for JSON/CSV/Markdown summaries.",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("temp/validation/runs"),
        help="Directory for per-file analysis/plan/cleaned/report artifacts.",
    )
    parser.add_argument(
        "--source-types",
        type=str,
        default="gamma,notebooklm,other",
        help="Comma-separated source types to include: gamma,notebooklm,other",
    )
    parser.add_argument(
        "--max-files",
        type=int,
        default=0,
        help="Optional cap for total files processed (0 means all).",
    )
    parser.add_argument(
        "--mode",
        type=str,
        choices=SUPPORTED_MODES,
        default="analyze-apply",
        help="analyze-only or analyze-apply (default).",
    )
    args = parser.parse_args()

    selected_source_types = parse_source_types(args.source_types)
    samples = collect_samples(
        samples_root=args.samples_root,
        source_types=selected_source_types,
        max_files=args.max_files,
    )
    if not samples:
        raise SystemExit(
            f"No PDF files found under {args.samples_root} for sourceTypes={selected_source_types}"
        )

    args.work_dir.mkdir(parents=True, exist_ok=True)

    output_json_path = resolve_output_json_path(args.output_prefix, args.output)
    file_results: list[ValidationFileResult] = []
    for source_type, sample in samples:
        file_results.append(
            validate_single_file(
                sample,
                args.work_dir,
                source_type=source_type,
                mode=args.mode,
            )
        )

    summary = build_summary(
        samples_root=args.samples_root,
        output_path=output_json_path,
        file_results=file_results,
        selected_source_types=selected_source_types,
        mode=args.mode,
    )
    output_json_path.parent.mkdir(parents=True, exist_ok=True)
    output_json_path.write_text(
        json.dumps(summary, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    csv_path = output_json_path.with_suffix(".csv")
    markdown_path = output_json_path.with_suffix(".md")
    write_csv_summary(file_results, csv_path)
    write_markdown_summary(summary, markdown_path)

    print(f"[validation] samples={len(samples)} output={output_json_path}")
    print(f"[validation] csv={csv_path}")
    print(f"[validation] markdown={markdown_path}")
    print(
        "[validation] usable={usable} / {total}".format(
            usable=summary["totals"]["usableFiles"],
            total=summary["totals"]["totalFiles"],
        )
    )
    return 0


def validate_single_file(
    sample_pdf: Path,
    work_dir: Path,
    *,
    source_type: str | None = None,
    mode: str = "analyze-apply",
) -> ValidationFileResult:
    slug = sample_pdf.stem.replace(" ", "_")
    file_dir = work_dir / slug
    file_dir.mkdir(parents=True, exist_ok=True)

    analysis = analysis_result_to_dict(analyze_pdf_candidates(sample_pdf))
    (file_dir / "analysis.json").write_text(
        json.dumps(analysis, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )

    all_candidates = _flatten_candidates(analysis)
    supported_candidates = [c for c in all_candidates if c.get("removability") == "supported"]
    unsupported_candidates = [
        c for c in all_candidates if c.get("removability") == "unsupported"
    ]
    unsupported_reason_codes = sorted(
        {
            str(candidate.get("unsupportedReasonCode") or candidate.get("reasonCode"))
            for candidate in unsupported_candidates
            if candidate.get("unsupportedReasonCode") or candidate.get("reasonCode")
        }
    )
    supported_reason_codes = sorted(
        {
            str(candidate.get("reasonCode"))
            for candidate in supported_candidates
            if candidate.get("reasonCode")
        }
    )

    target_found = _target_branding_found(analysis)

    selected_candidate = _pick_candidate_for_apply(analysis)
    if selected_candidate is None:
        return ValidationFileResult(
            source_type=source_type or detect_source_type(sample_pdf),
            filename=sample_pdf.name,
            pages=int(analysis.get("totalPages", 0)),
            candidate_count=len(all_candidates),
            supported_candidate_count=len(supported_candidates),
            unsupported_candidate_count=len(unsupported_candidates),
            target_logo_footer_header_found=target_found,
            cleaned_output_produced=False,
            usable=False,
            unsupported_reason_codes=unsupported_reason_codes,
            selected_candidate_id=None,
            selected_candidate_type=None,
            selected_candidate_reason_code=None,
            failure_reason="no_supported_candidate_for_apply",
            supported_reason_codes=supported_reason_codes,
            apply_attempted=False,
        )

    if mode == "analyze-only":
        return ValidationFileResult(
            source_type=source_type or detect_source_type(sample_pdf),
            filename=sample_pdf.name,
            pages=int(analysis.get("totalPages", 0)),
            candidate_count=len(all_candidates),
            supported_candidate_count=len(supported_candidates),
            unsupported_candidate_count=len(unsupported_candidates),
            target_logo_footer_header_found=target_found,
            cleaned_output_produced=False,
            usable=False,
            unsupported_reason_codes=unsupported_reason_codes,
            selected_candidate_id=selected_candidate.get("id"),
            selected_candidate_type=selected_candidate.get("objectType"),
            selected_candidate_reason_code=selected_candidate.get("reasonCode"),
            failure_reason="analyze_only_mode",
            supported_reason_codes=supported_reason_codes,
            apply_attempted=False,
        )

    plan = _build_plan_from_candidate(
        source_file_name=sample_pdf.name,
        candidate=selected_candidate,
        target_pages=_target_pages_for_repeat_key(analysis, selected_candidate["repeatKey"]),
    )
    plan_path = file_dir / "plan.json"
    output_pdf = file_dir / "cleaned.pdf"
    report_path = file_dir / "report.json"
    plan_path.write_text(
        json.dumps(plan, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )

    cleaned_output_produced = False
    usable = False
    failure_reason: str | None = None
    try:
        outcome = apply_removal_plan(sample_pdf, output_pdf, plan=parse_plan(plan))
        report = {
            "success": outcome.success,
            "objectType": outcome.object_type,
            "matchedObjectsCount": outcome.matched_objects_count,
            "removedObjectsCount": outcome.removed_objects_count,
            "warnings": outcome.warnings,
            "unsupportedFlags": outcome.unsupported_flags,
            "failureReason": outcome.failure_reason,
        }
        report_path.write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        cleaned_output_produced = output_pdf.exists()
        usable = bool(
            cleaned_output_produced
            and outcome.success
            and outcome.removed_objects_count > 0
            and outcome.matched_objects_count > 0
        )
        if not usable:
            failure_reason = "apply_plan_no_effect"
    except RemovalError as error:
        failure_reason = str(error)
        report_path.write_text(
            json.dumps(
                {
                    "success": False,
                    "failureReason": failure_reason,
                },
                indent=2,
                ensure_ascii=False,
                sort_keys=True,
            ),
            encoding="utf-8",
        )

    return ValidationFileResult(
        source_type=source_type or detect_source_type(sample_pdf),
        filename=sample_pdf.name,
        pages=int(analysis.get("totalPages", 0)),
        candidate_count=len(all_candidates),
        supported_candidate_count=len(supported_candidates),
        unsupported_candidate_count=len(unsupported_candidates),
        target_logo_footer_header_found=target_found,
        cleaned_output_produced=cleaned_output_produced,
        usable=usable,
        unsupported_reason_codes=unsupported_reason_codes,
        selected_candidate_id=selected_candidate.get("id"),
        selected_candidate_type=selected_candidate.get("objectType"),
        selected_candidate_reason_code=selected_candidate.get("reasonCode"),
        failure_reason=failure_reason,
        supported_reason_codes=supported_reason_codes,
        apply_attempted=True,
    )


def build_summary(
    *,
    samples_root: Path,
    output_path: Path,
    file_results: list[ValidationFileResult],
    selected_source_types: list[str],
    mode: str,
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    source_breakdown = total_files_by_source_type(file_results)
    usable_by_source = usable_files_by_source_type(file_results)
    usable_count = sum(1 for result in file_results if result.usable)
    cleaned_count = sum(1 for result in file_results if result.cleaned_output_produced)
    unsupported_file_count = len(file_results) - usable_count
    aggregate = build_aggregate_metrics(file_results)
    prioritization = build_prioritization(summary_aggregate=aggregate)

    return {
        "schemaVersion": "1.0",
        "generatedAt": now,
        "samplesRoot": str(samples_root),
        "outputPath": str(output_path),
        "mode": mode,
        "selectedSourceTypes": selected_source_types,
        "totals": {
            "totalFiles": len(file_results),
            "usableFiles": usable_count,
            "unsupportedFiles": unsupported_file_count,
            "cleanedOutputFiles": cleaned_count,
            "sourceBreakdown": source_breakdown,
            "totalFilesBySourceType": source_breakdown,
            "usableFilesBySourceType": usable_by_source,
        },
        "aggregate": aggregate,
        "prioritization": prioritization,
        "files": [result.to_dict() for result in file_results],
    }


def build_aggregate_metrics(file_results: list[ValidationFileResult]) -> dict[str, Any]:
    usable_by_source: dict[str, dict[str, float | int]] = {}
    support_rate_by_source: dict[str, dict[str, float | int]] = {}
    unsupported_reason_counter: Counter[str] = Counter()
    supported_reason_counter: Counter[str] = Counter()
    unsupported_reason_by_source: dict[str, Counter[str]] = {}
    supported_reason_by_source: dict[str, Counter[str]] = {}

    for result in file_results:
        bucket = usable_by_source.setdefault(
            result.source_type,
            {"total": 0, "usable": 0, "usableRate": 0.0},
        )
        bucket["total"] = int(bucket["total"]) + 1
        if result.usable:
            bucket["usable"] = int(bucket["usable"]) + 1
        support_bucket = support_rate_by_source.setdefault(
            result.source_type,
            {"candidateTotal": 0, "supportedCandidateTotal": 0, "supportedCandidateRate": 0.0},
        )
        support_bucket["candidateTotal"] = int(support_bucket["candidateTotal"]) + result.candidate_count
        support_bucket["supportedCandidateTotal"] = int(
            support_bucket["supportedCandidateTotal"]
        ) + result.supported_candidate_count

        for reason in result.unsupported_reason_codes:
            unsupported_reason_counter[reason] += 1
            unsupported_reason_by_source.setdefault(result.source_type, Counter())[reason] += 1
        for reason in result.supported_reason_codes:
            supported_reason_counter[reason] += 1
            supported_reason_by_source.setdefault(result.source_type, Counter())[reason] += 1

    for source, bucket in usable_by_source.items():
        total = int(bucket["total"])
        usable = int(bucket["usable"])
        bucket["usableRate"] = round((usable / total) if total > 0 else 0.0, 4)
        usable_by_source[source] = bucket
    for source, bucket in support_rate_by_source.items():
        total = int(bucket["candidateTotal"])
        supported_total = int(bucket["supportedCandidateTotal"])
        bucket["supportedCandidateRate"] = round((supported_total / total) if total > 0 else 0.0, 4)
        support_rate_by_source[source] = bucket

    return {
        "totalFilesBySourceType": total_files_by_source_type(file_results),
        "usableFilesBySourceType": usable_files_by_source_type(file_results),
        "usableRateBySourceType": usable_by_source,
        "supportedCandidateRateBySourceType": support_rate_by_source,
        "unsupportedReasonDistributionBySourceType": {
            source: dict(counter) for source, counter in unsupported_reason_by_source.items()
        },
        "supportedReasonDistributionBySourceType": {
            source: dict(counter) for source, counter in supported_reason_by_source.items()
        },
        "topUnsupportedReasonCodes": unsupported_reason_counter.most_common(8),
        "topSupportedReasonCodes": supported_reason_counter.most_common(8),
    }


def build_prioritization(summary_aggregate: dict[str, Any]) -> dict[str, Any]:
    usable_rates = summary_aggregate.get("usableRateBySourceType", {})
    weakest_source = None
    weakest_rate = 2.0
    for source, payload in usable_rates.items():
        rate = float(payload.get("usableRate", 0.0))
        if rate < weakest_rate:
            weakest_rate = rate
            weakest_source = source

    priority_unsupported = [
        code
        for code, _count in (summary_aggregate.get("topUnsupportedReasonCodes", []) or [])[:3]
    ]
    priority_supported_expand = [
        code
        for code, _count in (summary_aggregate.get("topSupportedReasonCodes", []) or [])[:3]
    ]

    recommended_focus: list[str] = []
    if weakest_source:
        recommended_focus.append(
            f"Focus on {weakest_source} first; usable rate currently {weakest_rate:.2f}."
        )
    for code in priority_unsupported:
        hint = FUTURE_REASON_WORK_HINTS.get(code)
        if hint:
            recommended_focus.append(f"{code}: {hint}")
        else:
            recommended_focus.append(f"{code}: inspect grouped candidates and refine fail-safe boundaries.")

    return {
        "weakestSourceType": weakest_source,
        "priorityUnsupportedReasons": priority_unsupported,
        "prioritySupportedPatternsToExpand": priority_supported_expand,
        "recommendedNextFocus": recommended_focus,
    }


def detect_source_type(sample_pdf: Path) -> str:
    path_lower = str(sample_pdf).lower()
    if "notebooklm" in path_lower:
        return "notebooklm"
    if "gamma" in path_lower:
        return "gamma"
    return "other"


def parse_source_types(raw: str) -> list[str]:
    parsed = [token.strip().lower() for token in raw.split(",") if token.strip()]
    if not parsed:
        return list(SUPPORTED_SOURCE_TYPES)
    invalid = [token for token in parsed if token not in SUPPORTED_SOURCE_TYPES]
    if invalid:
        raise SystemExit(
            f"Invalid source type(s): {invalid}. Allowed: {', '.join(SUPPORTED_SOURCE_TYPES)}"
        )
    return parsed


def collect_samples(
    *,
    samples_root: Path,
    source_types: list[str],
    max_files: int,
) -> list[tuple[str, Path]]:
    samples: list[tuple[str, Path]] = []
    seen_paths: set[Path] = set()
    for source_type in source_types:
        source_dir = samples_root / source_type
        if not source_dir.exists():
            continue
        for sample in sorted(source_dir.rglob("*.pdf")):
            if sample in seen_paths:
                continue
            samples.append((source_type, sample))
            seen_paths.add(sample)
            if max_files > 0 and len(samples) >= max_files:
                return samples

    # Backward-compatible fallback: flat PDFs under corpus root are treated as "other".
    if "other" in source_types:
        for sample in sorted(samples_root.glob("*.pdf")):
            if sample in seen_paths:
                continue
            samples.append(("other", sample))
            seen_paths.add(sample)
            if max_files > 0 and len(samples) >= max_files:
                return samples
    return samples


def resolve_output_json_path(output_prefix: Path, legacy_output: Path | None) -> Path:
    if legacy_output is not None:
        return legacy_output
    if output_prefix.suffix == ".json":
        return output_prefix
    return output_prefix.with_suffix(".json")


def write_csv_summary(file_results: list[ValidationFileResult], csv_path: Path) -> None:
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "sourceType",
                "filename",
                "pages",
                "candidateCount",
                "supportedCandidateCount",
                "unsupportedCandidateCount",
                "targetLogoFooterHeaderFound",
                "cleanedOutputProduced",
                "usable",
                "selectedCandidateReasonCode",
                "unsupportedReasonCodes",
                "failureReason",
            ]
        )
        for result in file_results:
            writer.writerow(
                [
                    result.source_type,
                    result.filename,
                    result.pages,
                    result.candidate_count,
                    result.supported_candidate_count,
                    result.unsupported_candidate_count,
                    _bool_cell(result.target_logo_footer_header_found),
                    _bool_cell(result.cleaned_output_produced),
                    _bool_cell(result.usable),
                    result.selected_candidate_reason_code or "",
                    ";".join(result.unsupported_reason_codes),
                    result.failure_reason or "",
                ]
            )


def write_markdown_summary(summary: dict[str, Any], markdown_path: Path) -> None:
    markdown_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    lines.append("# Gamma / NotebookLM Validation Summary")
    lines.append("")
    lines.append(f"- Generated: `{summary.get('generatedAt')}`")
    lines.append(f"- Samples root: `{summary.get('samplesRoot')}`")
    lines.append(f"- Mode: `{summary.get('mode')}`")
    lines.append(f"- Source types: `{','.join(summary.get('selectedSourceTypes', []))}`")
    lines.append("")

    totals = summary.get("totals", {})
    lines.append("## Aggregate")
    lines.append("")
    lines.append(f"- Total files: **{totals.get('totalFiles', 0)}**")
    lines.append(f"- Usable files: **{totals.get('usableFiles', 0)}**")
    lines.append(f"- Unsupported files: **{totals.get('unsupportedFiles', 0)}**")
    lines.append(f"- Cleaned output files: **{totals.get('cleanedOutputFiles', 0)}**")
    lines.append("")

    aggregate = summary.get("aggregate", {})
    lines.append("### Usable Rate By Source Type")
    lines.append("")
    lines.append("| sourceType | total | usable | usableRate |")
    lines.append("| --- | ---: | ---: | ---: |")
    for source, stats in (aggregate.get("usableRateBySourceType") or {}).items():
        lines.append(
            f"| {source} | {stats.get('total', 0)} | {stats.get('usable', 0)} | {stats.get('usableRate', 0)} |"
        )
    lines.append("")

    lines.append("### Top Unsupported Reason Codes")
    lines.append("")
    lines.append("| reasonCode | count |")
    lines.append("| --- | ---: |")
    for reason, count in aggregate.get("topUnsupportedReasonCodes", []):
        lines.append(f"| {reason} | {count} |")
    lines.append("")

    lines.append("### Top Supported Reason Codes")
    lines.append("")
    lines.append("| reasonCode | count |")
    lines.append("| --- | ---: |")
    for reason, count in aggregate.get("topSupportedReasonCodes", []):
        lines.append(f"| {reason} | {count} |")
    lines.append("")

    lines.append("### Prioritization")
    lines.append("")
    prioritization = summary.get("prioritization", {})
    lines.append(f"- Weakest source type: `{prioritization.get('weakestSourceType')}`")
    lines.append(
        f"- Priority unsupported reasons: `{','.join(prioritization.get('priorityUnsupportedReasons', []))}`"
    )
    lines.append(
        f"- Priority supported patterns to expand: `{','.join(prioritization.get('prioritySupportedPatternsToExpand', []))}`"
    )
    for item in prioritization.get("recommendedNextFocus", []):
        lines.append(f"- {item}")
    lines.append("")

    lines.append("## Per File")
    lines.append("")
    lines.append(
        "| sourceType | filename | pages | candidates | supported | unsupported | targetFound | cleaned | usable | selectedReason | unsupportedReasons | failureReason |"
    )
    lines.append(
        "| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |"
    )
    for file_item in summary.get("files", []):
        lines.append(
            "| {sourceType} | {filename} | {pages} | {candidateCount} | {supportedCandidateCount} | {unsupportedCandidateCount} | {targetLogoFooterHeaderFound} | {cleanedOutputProduced} | {usable} | {selectedCandidateReasonCode} | {unsupportedReasonCodes} | {failureReason} |".format(
                sourceType=file_item.get("sourceType", ""),
                filename=file_item.get("filename", ""),
                pages=file_item.get("pages", 0),
                candidateCount=file_item.get("candidateCount", 0),
                supportedCandidateCount=file_item.get("supportedCandidateCount", 0),
                unsupportedCandidateCount=file_item.get("unsupportedCandidateCount", 0),
                targetLogoFooterHeaderFound=_bool_cell(
                    bool(file_item.get("targetLogoFooterHeaderFound", False))
                ),
                cleanedOutputProduced=_bool_cell(
                    bool(file_item.get("cleanedOutputProduced", False))
                ),
                usable=_bool_cell(bool(file_item.get("usable", False))),
                selectedCandidateReasonCode=file_item.get("selectedCandidateReasonCode", "")
                or "",
                unsupportedReasonCodes=";".join(file_item.get("unsupportedReasonCodes", [])),
                failureReason=file_item.get("failureReason", "") or "",
            )
        )

    markdown_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _bool_cell(value: bool) -> str:
    return "yes" if value else "no"


def total_files_by_source_type(file_results: list[ValidationFileResult]) -> dict[str, int]:
    counter: dict[str, int] = {}
    for result in file_results:
        counter[result.source_type] = counter.get(result.source_type, 0) + 1
    return counter


def usable_files_by_source_type(file_results: list[ValidationFileResult]) -> dict[str, int]:
    counter: dict[str, int] = {}
    for result in file_results:
        if result.usable:
            counter[result.source_type] = counter.get(result.source_type, 0) + 1
    return counter


def _flatten_candidates(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for candidates in analysis.get("candidatesByPage", {}).values():
        out.extend(candidates)
    return out


def _target_branding_found(analysis: dict[str, Any]) -> bool:
    for group in analysis.get("repeatGroups", []):
        if group.get("objectType") not in {"text_run", "image_xobject"}:
            continue
        placement = group.get("placementHint")
        if placement in {"corner", "header", "footer"} and group.get("repeatCount", 0) >= 2:
            return True
    return False


def _pick_candidate_for_apply(analysis: dict[str, Any]) -> dict[str, Any] | None:
    candidates = _flatten_candidates(analysis)
    supported = [candidate for candidate in candidates if candidate.get("removability") == "supported"]
    if not supported:
        return None

    def rank(candidate: dict[str, Any]) -> tuple[int, int, float]:
        object_type = str(candidate.get("objectType"))
        placement = str(candidate.get("placementHint"))
        confidence = float(candidate.get("confidence", 0))
        if object_type == "image_xobject" and placement == "corner":
            type_rank = 0
        elif object_type == "text_run" and placement in {"header", "footer"}:
            type_rank = 1
        elif object_type == "image_xobject":
            type_rank = 2
        else:
            type_rank = 3

        repeat_count = int(candidate.get("repeatCount", 0))
        return (type_rank, -repeat_count, -confidence)

    supported.sort(key=rank)
    return supported[0]


def _target_pages_for_repeat_key(analysis: dict[str, Any], repeat_key: str) -> list[int]:
    for group in analysis.get("repeatGroups", []):
        if group.get("repeatKey") == repeat_key:
            pages = sorted({int(page) for page in group.get("pages", [])})
            if pages:
                return pages
    pages_from_candidates = sorted(
        {
            int(candidate.get("pageNumber"))
            for candidate in _flatten_candidates(analysis)
            if candidate.get("repeatKey") == repeat_key
        }
    )
    return pages_from_candidates


def parse_plan(raw: dict[str, Any]):  # type: ignore[no-untyped-def]
    from models.plan import parse_plan_dict

    return parse_plan_dict(raw)


def _build_plan_from_candidate(
    *,
    source_file_name: str,
    candidate: dict[str, Any],
    target_pages: list[int],
) -> dict[str, Any]:
    selected_candidate = {
        "id": candidate["id"],
        "pageNumber": int(candidate["pageNumber"]),
        "objectType": candidate["objectType"],
        "label": candidate["label"],
        "repeatKey": candidate["repeatKey"],
        "confidence": float(candidate["confidence"]),
        "removability": candidate.get("removability", "supported"),
    }
    if candidate.get("objectType") == "image_xobject":
        selected_candidate["imageIdentityKey"] = candidate.get("imageIdentityKey")
        selected_candidate["resourceName"] = candidate.get("resourceName")

    return {
        "planVersion": "1.0",
        "createdAt": datetime.now(UTC).isoformat(),
        "sourceFileName": source_file_name,
        "selectedCandidate": selected_candidate,
        "scope": {
            "mode": "all",
            "targetPages": target_pages,
            "strategy": "all_matching_repeat_key",
        },
        "preferredEngines": ["pikepdf", "PyMuPDF"],
        "preservationGoal": "Preserve slide readability and structure.",
        "engineHints": ["gamma/notebooklm corpus validation"],
        "riskLevel": "low",
        "notes": ["generated by corpus validation workflow"],
    }


if __name__ == "__main__":
    raise SystemExit(main())

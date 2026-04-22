"""Compare two corpus validation summaries and export delta reports."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="compare-validation-runs",
        description="Compare before/after corpus validation summaries.",
    )
    parser.add_argument("--before", type=Path, required=True, help="Before summary JSON path.")
    parser.add_argument("--after", type=Path, required=True, help="After summary JSON path.")
    parser.add_argument(
        "--output-prefix",
        type=Path,
        required=True,
        help="Output prefix for comparison JSON and Markdown.",
    )
    args = parser.parse_args()

    before = json.loads(args.before.read_text(encoding="utf-8"))
    after = json.loads(args.after.read_text(encoding="utf-8"))
    comparison = build_comparison(before=before, after=after)

    output_json = ensure_json_path(args.output_prefix)
    output_md = output_json.with_suffix(".md")
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(comparison, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    output_md.write_text(build_markdown_report(comparison), encoding="utf-8")

    print(f"[compare] before={args.before}")
    print(f"[compare] after={args.after}")
    print(f"[compare] json={output_json}")
    print(f"[compare] markdown={output_md}")
    return 0


def build_comparison(*, before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    source_types = sorted(
        set(before.get("aggregate", {}).get("usableRateBySourceType", {}).keys())
        | set(after.get("aggregate", {}).get("usableRateBySourceType", {}).keys())
    )

    usable_rate_delta: dict[str, float] = {}
    usable_files_delta: dict[str, int] = {}
    candidate_totals_delta: dict[str, dict[str, int]] = {}
    unsupported_reason_delta: dict[str, dict[str, int]] = {}
    supported_reason_delta: dict[str, dict[str, int]] = {}

    for source_type in source_types:
        before_rate = (
            before.get("aggregate", {})
            .get("usableRateBySourceType", {})
            .get(source_type, {})
            .get("usableRate", 0.0)
        )
        after_rate = (
            after.get("aggregate", {})
            .get("usableRateBySourceType", {})
            .get(source_type, {})
            .get("usableRate", 0.0)
        )
        usable_rate_delta[source_type] = round(float(after_rate) - float(before_rate), 4)

        before_usable_files = (
            before.get("aggregate", {}).get("usableFilesBySourceType", {}).get(source_type, 0)
        )
        after_usable_files = (
            after.get("aggregate", {}).get("usableFilesBySourceType", {}).get(source_type, 0)
        )
        usable_files_delta[source_type] = int(after_usable_files) - int(before_usable_files)

        before_candidates = sum_candidate_fields(before.get("files", []), source_type)
        after_candidates = sum_candidate_fields(after.get("files", []), source_type)
        candidate_totals_delta[source_type] = {
            "candidateCountDelta": after_candidates["candidateCount"] - before_candidates["candidateCount"],
            "supportedCandidateCountDelta": after_candidates["supportedCandidateCount"]
            - before_candidates["supportedCandidateCount"],
            "unsupportedCandidateCountDelta": after_candidates["unsupportedCandidateCount"]
            - before_candidates["unsupportedCandidateCount"],
        }

        before_unsupported = (
            before.get("aggregate", {})
            .get("unsupportedReasonDistributionBySourceType", {})
            .get(source_type, {})
        )
        after_unsupported = (
            after.get("aggregate", {})
            .get("unsupportedReasonDistributionBySourceType", {})
            .get(source_type, {})
        )
        unsupported_reason_delta[source_type] = dict_delta(before_unsupported, after_unsupported)

        before_supported = (
            before.get("aggregate", {})
            .get("supportedReasonDistributionBySourceType", {})
            .get(source_type, {})
        )
        after_supported = (
            after.get("aggregate", {})
            .get("supportedReasonDistributionBySourceType", {})
            .get(source_type, {})
        )
        supported_reason_delta[source_type] = dict_delta(before_supported, after_supported)

    top_supported_delta = tuple_list_delta(
        before.get("aggregate", {}).get("topSupportedReasonCodes", []),
        after.get("aggregate", {}).get("topSupportedReasonCodes", []),
    )

    file_transition = compare_file_transitions(before.get("files", []), after.get("files", []))
    recommendation_quality = compare_recommendation_quality(
        before_files=before.get("files", []),
        after_files=after.get("files", []),
    )

    return {
        "schemaVersion": "1.0",
        "beforeGeneratedAt": before.get("generatedAt"),
        "afterGeneratedAt": after.get("generatedAt"),
        "beforePath": before.get("outputPath"),
        "afterPath": after.get("outputPath"),
        "delta": {
            "usableRateBySourceType": usable_rate_delta,
            "usableFilesBySourceType": usable_files_delta,
            "candidateTotalsBySourceType": candidate_totals_delta,
            "unsupportedReasonDistributionBySourceType": unsupported_reason_delta,
            "supportedReasonDistributionBySourceType": supported_reason_delta,
            "topSupportedReasonCodes": top_supported_delta,
        },
        "fileTransitions": file_transition,
        "recommendationQuality": recommendation_quality,
    }


def compare_file_transitions(
    before_files: list[dict[str, Any]],
    after_files: list[dict[str, Any]],
) -> dict[str, Any]:
    before_map = {
        (str(item.get("sourceType")), str(item.get("filename"))): bool(item.get("usable", False))
        for item in before_files
    }
    after_map = {
        (str(item.get("sourceType")), str(item.get("filename"))): bool(item.get("usable", False))
        for item in after_files
    }
    improved: list[dict[str, str]] = []
    regressed: list[dict[str, str]] = []
    unchanged: list[dict[str, str]] = []

    keys = sorted(set(before_map.keys()) | set(after_map.keys()))
    for source_type, filename in keys:
        before_usable = before_map.get((source_type, filename), False)
        after_usable = after_map.get((source_type, filename), False)
        row = {"sourceType": source_type, "filename": filename}
        if not before_usable and after_usable:
            improved.append(row)
        elif before_usable and not after_usable:
            regressed.append(row)
        else:
            unchanged.append(row)

    return {
        "improvedUnusableToUsable": improved,
        "regressedUsableToUnusable": regressed,
        "unchanged": unchanged,
    }


def compare_recommendation_quality(
    *,
    before_files: list[dict[str, Any]],
    after_files: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "before": recommendation_quality_snapshot(before_files),
        "after": recommendation_quality_snapshot(after_files),
        "delta": recommendation_quality_delta(
            recommendation_quality_snapshot(before_files),
            recommendation_quality_snapshot(after_files),
        ),
    }


def recommendation_quality_snapshot(files: list[dict[str, Any]]) -> dict[str, dict[str, float | int]]:
    by_source: dict[str, dict[str, float | int]] = {}
    for item in files:
        source = str(item.get("sourceType", "unknown"))
        bucket = by_source.setdefault(
            source,
            {
                "recommendedCandidatePresentCount": 0,
                "recommendationMatchedSuccessfulApply": 0,
                "recommendedCandidateUsableHitCount": 0,
                "recommendationSuccessRate": 0.0,
            },
        )
        has_recommended = bool(item.get("selectedCandidateId"))
        usable = bool(item.get("usable", False))
        if has_recommended:
            bucket["recommendedCandidatePresentCount"] = int(
                bucket["recommendedCandidatePresentCount"]
            ) + 1
            if usable:
                bucket["recommendationMatchedSuccessfulApply"] = int(
                    bucket["recommendationMatchedSuccessfulApply"]
                ) + 1
                bucket["recommendedCandidateUsableHitCount"] = int(
                    bucket["recommendedCandidateUsableHitCount"]
                ) + 1

    for source, bucket in by_source.items():
        total = int(bucket["recommendedCandidatePresentCount"])
        success = int(bucket["recommendationMatchedSuccessfulApply"])
        bucket["recommendationSuccessRate"] = round((success / total) if total > 0 else 0.0, 4)
        by_source[source] = bucket
    return by_source


def recommendation_quality_delta(
    before: dict[str, dict[str, float | int]],
    after: dict[str, dict[str, float | int]],
) -> dict[str, dict[str, float]]:
    keys = sorted(set(before.keys()) | set(after.keys()))
    delta: dict[str, dict[str, float]] = {}
    for source in keys:
        delta[source] = {
            "recommendedCandidatePresentCountDelta": float(
                after.get(source, {}).get("recommendedCandidatePresentCount", 0)
            )
            - float(before.get(source, {}).get("recommendedCandidatePresentCount", 0)),
            "recommendationMatchedSuccessfulApplyDelta": float(
                after.get(source, {}).get("recommendationMatchedSuccessfulApply", 0)
            )
            - float(before.get(source, {}).get("recommendationMatchedSuccessfulApply", 0)),
            "recommendedCandidateUsableHitCountDelta": float(
                after.get(source, {}).get("recommendedCandidateUsableHitCount", 0)
            )
            - float(before.get(source, {}).get("recommendedCandidateUsableHitCount", 0)),
            "recommendationSuccessRateDelta": round(
                float(after.get(source, {}).get("recommendationSuccessRate", 0.0))
                - float(before.get(source, {}).get("recommendationSuccessRate", 0.0)),
                4,
            ),
        }
    return delta


def sum_candidate_fields(files: list[dict[str, Any]], source_type: str) -> dict[str, int]:
    subset = [item for item in files if str(item.get("sourceType")) == source_type]
    return {
        "candidateCount": sum(int(item.get("candidateCount", 0)) for item in subset),
        "supportedCandidateCount": sum(
            int(item.get("supportedCandidateCount", 0)) for item in subset
        ),
        "unsupportedCandidateCount": sum(
            int(item.get("unsupportedCandidateCount", 0)) for item in subset
        ),
    }


def dict_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, int]:
    keys = sorted(set(before.keys()) | set(after.keys()))
    return {key: int(after.get(key, 0)) - int(before.get(key, 0)) for key in keys}


def tuple_list_delta(before: list[list[Any]], after: list[list[Any]]) -> dict[str, int]:
    before_map = {str(item[0]): int(item[1]) for item in before if len(item) >= 2}
    after_map = {str(item[0]): int(item[1]) for item in after if len(item) >= 2}
    return dict_delta(before_map, after_map)


def ensure_json_path(output_prefix: Path) -> Path:
    if output_prefix.suffix == ".json":
        return output_prefix
    return output_prefix.with_suffix(".json")


def build_markdown_report(comparison: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Validation Delta Report")
    lines.append("")
    lines.append(f"- Before: `{comparison.get('beforePath')}`")
    lines.append(f"- After: `{comparison.get('afterPath')}`")
    lines.append("")

    delta = comparison.get("delta", {})
    lines.append("## Usable Rate Delta")
    lines.append("")
    lines.append("| sourceType | usableRateDelta | usableFilesDelta |")
    lines.append("| --- | ---: | ---: |")
    for source, rate in (delta.get("usableRateBySourceType", {}) or {}).items():
        files_delta = (delta.get("usableFilesBySourceType", {}) or {}).get(source, 0)
        lines.append(f"| {source} | {rate} | {files_delta} |")
    lines.append("")

    lines.append("## File Transitions")
    lines.append("")
    transitions = comparison.get("fileTransitions", {})
    lines.append(f"- improved unusable->usable: {len(transitions.get('improvedUnusableToUsable', []))}")
    lines.append(f"- regressed usable->unusable: {len(transitions.get('regressedUsableToUnusable', []))}")
    lines.append("")

    lines.append("## Recommendation Quality Delta")
    lines.append("")
    lines.append("| sourceType | recommendedHitDelta | successRateDelta |")
    lines.append("| --- | ---: | ---: |")
    for source, payload in (comparison.get("recommendationQuality", {}).get("delta", {}) or {}).items():
        lines.append(
            f"| {source} | {payload.get('recommendedCandidateUsableHitCountDelta', 0)} | {payload.get('recommendationSuccessRateDelta', 0)} |"
        )
    lines.append("")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())

"""Focused forensic diagnosis for currently failing Gamma corpus files."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class GammaFailureDiagnosis:
    filename: str
    pages: int
    dominant_unsupported_reason_codes: list[str]
    target_logo_footer_header_found: bool
    classification: str
    decision_bucket: str
    categories: list[str]
    why_not_usable: str
    explanation: str
    candidate_count: int
    supported_candidate_count: int
    review_required_candidate_count: int
    repeated_group_count: int
    repeated_non_background_group_count: int
    repeated_background_group_count: int
    failure_reason: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "pages": self.pages,
            "dominantUnsupportedReasonCodes": self.dominant_unsupported_reason_codes,
            "targetLogoFooterHeaderFound": self.target_logo_footer_header_found,
            "classification": self.classification,
            "decisionBucket": self.decision_bucket,
            "categories": self.categories,
            "whyNotUsable": self.why_not_usable,
            "explanation": self.explanation,
            "candidateCount": self.candidate_count,
            "supportedCandidateCount": self.supported_candidate_count,
            "reviewRequiredCandidateCount": self.review_required_candidate_count,
            "repeatedGroupCount": self.repeated_group_count,
            "repeatedNonBackgroundGroupCount": self.repeated_non_background_group_count,
            "repeatedBackgroundGroupCount": self.repeated_background_group_count,
            "failureReason": self.failure_reason,
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="gamma-plateau-diagnosis",
        description=(
            "Analyze currently failing Gamma files and classify recoverability boundaries "
            "for object-level cleanup."
        ),
    )
    parser.add_argument(
        "--summary-json",
        type=Path,
        default=Path("temp/validation/gamma-notebooklm-after-5d.json"),
        help="Validation summary JSON path.",
    )
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path("temp/validation/work-after-5d"),
        help="Per-file analysis work directory used by corpus validation.",
    )
    parser.add_argument(
        "--output-prefix",
        type=Path,
        default=Path("temp/validation/gamma-plateau-diagnosis"),
        help="Output prefix for JSON and Markdown.",
    )
    args = parser.parse_args()

    summary = json.loads(args.summary_json.read_text(encoding="utf-8"))
    gamma_failures = [
        file_item
        for file_item in summary.get("files", [])
        if file_item.get("sourceType") == "gamma" and not file_item.get("usable", False)
    ]

    diagnoses = [
        _diagnose_gamma_failure(file_item, work_dir=args.work_dir) for file_item in gamma_failures
    ]
    result = _build_result_payload(summary=summary, diagnoses=diagnoses)

    output_json = args.output_prefix.with_suffix(".json")
    output_md = args.output_prefix.with_suffix(".md")
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True),
        encoding="utf-8",
    )
    output_md.write_text(_render_markdown_report(result), encoding="utf-8")

    print(f"[gamma-plateau] failures={len(diagnoses)} output={output_json}")
    print(f"[gamma-plateau] markdown={output_md}")
    return 0


def _diagnose_gamma_failure(
    file_item: dict[str, Any],
    *,
    work_dir: Path,
) -> GammaFailureDiagnosis:
    filename = str(file_item.get("filename", ""))
    pages = int(file_item.get("pages", 0))
    slug = Path(filename).stem
    analysis_path = work_dir / slug / "analysis.json"

    analysis: dict[str, Any] = {}
    if analysis_path.exists():
        analysis = json.loads(analysis_path.read_text(encoding="utf-8"))

    candidates = _flatten_candidates(analysis)
    reason_counter: Counter[str] = Counter()
    for candidate in candidates:
        if candidate.get("removability") != "unsupported":
            continue
        reason = str(candidate.get("unsupportedReasonCode") or candidate.get("reasonCode") or "")
        if reason:
            reason_counter[reason] += 1

    dominant_unsupported = [reason for reason, _ in reason_counter.most_common(3)]
    if not dominant_unsupported:
        dominant_unsupported = list(file_item.get("unsupportedReasonCodes", []))

    repeat_groups = analysis.get("repeatGroups", [])
    repeated_groups = [group for group in repeat_groups if int(group.get("repeatCount", 0)) >= 2]
    repeated_non_background = [
        group for group in repeated_groups if group.get("placementHint") != "background"
    ]
    repeated_background = [
        group for group in repeated_groups if group.get("placementHint") == "background"
    ]
    review_required_count = sum(
        1 for candidate in candidates if candidate.get("removability") == "review_required"
    )

    diagnosis = _classify_failure(
        file_item=file_item,
        dominant_unsupported=dominant_unsupported,
        repeated_groups=repeated_groups,
        repeated_non_background=repeated_non_background,
        repeated_background=repeated_background,
        review_required_count=review_required_count,
    )

    return GammaFailureDiagnosis(
        filename=filename,
        pages=pages,
        dominant_unsupported_reason_codes=dominant_unsupported,
        target_logo_footer_header_found=bool(file_item.get("targetLogoFooterHeaderFound", False)),
        classification=diagnosis["classification"],
        decision_bucket=diagnosis["decisionBucket"],
        categories=diagnosis["categories"],
        why_not_usable=diagnosis["whyNotUsable"],
        explanation=diagnosis["explanation"],
        candidate_count=int(file_item.get("candidateCount", 0)),
        supported_candidate_count=int(file_item.get("supportedCandidateCount", 0)),
        review_required_candidate_count=review_required_count,
        repeated_group_count=len(repeated_groups),
        repeated_non_background_group_count=len(repeated_non_background),
        repeated_background_group_count=len(repeated_background),
        failure_reason=file_item.get("failureReason"),
    )


def _classify_failure(
    *,
    file_item: dict[str, Any],
    dominant_unsupported: list[str],
    repeated_groups: list[dict[str, Any]],
    repeated_non_background: list[dict[str, Any]],
    repeated_background: list[dict[str, Any]],
    review_required_count: int,
) -> dict[str, Any]:
    has_large_background = "large_background_image" in dominant_unsupported
    has_non_repeated_image = "non_repeated_decorative_image" in dominant_unsupported
    has_unsupported_structure = "unsupported_structure" in dominant_unsupported
    target_found = bool(file_item.get("targetLogoFooterHeaderFound", False))
    supported_count = int(file_item.get("supportedCandidateCount", 0))
    failure_reason = str(file_item.get("failureReason") or "")

    if supported_count > 0 and failure_reason == "apply_plan_no_effect":
        return {
            "classification": "borderline_recoverable",
            "decisionBucket": "recoverable_with_small_targeted_improvement",
            "categories": ["candidate_found_but_apply_not_safe"],
            "whyNotUsable": (
                "A supported candidate was selected, but apply produced no effective removal."
            ),
            "explanation": (
                "This looks like an apply-stage precision issue rather than a parsing limitation. "
                "A narrow apply matching rule could be justified."
            ),
        }

    if repeated_non_background and review_required_count > 0:
        return {
            "classification": "clearly_recoverable_small_rule",
            "decisionBucket": "recoverable_with_small_targeted_improvement",
            "categories": ["repeated_but_low_confidence", "recommendation_not_actionable"],
            "whyNotUsable": (
                "There are repeated non-background objects, but confidence remains below auto-safe "
                "thresholds so no supported apply candidate is produced."
            ),
            "explanation": (
                "A narrow threshold/placement refinement could unlock this pattern while preserving "
                "fail-safe defaults."
            ),
        }

    if repeated_background and not repeated_non_background:
        categories = ["baked_into_large_background", "target_mark_not_independent_object"]
        if has_non_repeated_image:
            categories.append("non_repeated_logo_pattern")
        return {
            "classification": "fundamentally_unsupported",
            "decisionBucket": "needs_broader_strategy_change",
            "categories": categories,
            "whyNotUsable": (
                "Only background-scale repeats are present; detected corner/side marks are non-repeated "
                "singletons, so no independent removable overlay exists."
            ),
            "explanation": (
                "Fixing this would require a different strategy (background segmentation/masking or "
                "template reconstruction), not a small object-level rule."
            ),
        }

    if not repeated_groups:
        categories = ["target_mark_not_independent_object", "recommendation_not_actionable"]
        if has_non_repeated_image:
            categories.append("non_repeated_logo_pattern")
        if has_unsupported_structure:
            categories.append("unsupported_text_structure")
        return {
            "classification": "fundamentally_unsupported",
            "decisionBucket": "non_recoverable_under_current_strategy",
            "categories": categories,
            "whyNotUsable": (
                "No repeatable candidate pattern exists across pages, so the engine cannot produce a "
                "safe object-level apply plan."
            ),
            "explanation": (
                "Current strategy depends on repeated independent objects. This file lacks those signals, "
                "so further heuristic expansion would likely increase risk without meaningful gain."
            ),
        }

    if has_large_background and not target_found:
        return {
            "classification": "fundamentally_unsupported",
            "decisionBucket": "non_recoverable_under_current_strategy",
            "categories": ["baked_into_large_background", "target_mark_not_independent_object"],
            "whyNotUsable": (
                "Detected patterns are dominated by large background objects and do not expose a stable "
                "removable logo/header/footer object."
            ),
            "explanation": (
                "This remains outside the current safe object-level boundary."
            ),
        }

    return {
        "classification": "borderline_recoverable",
        "decisionBucket": "recoverable_with_small_targeted_improvement",
        "categories": ["recommendation_not_actionable"],
        "whyNotUsable": "Current recommendation was not actionable for apply.",
        "explanation": (
            "Needs case-by-case inspection; appears closer to threshold tuning than strategy change."
        ),
    }


def _build_result_payload(
    *,
    summary: dict[str, Any],
    diagnoses: list[GammaFailureDiagnosis],
) -> dict[str, Any]:
    bucket_counts: Counter[str] = Counter(d.decision_bucket for d in diagnoses)
    category_counts: Counter[str] = Counter()
    for diagnosis in diagnoses:
        category_counts.update(diagnosis.categories)

    gamma_rate = (
        (summary.get("aggregate", {}).get("usableRateBySourceType", {}) or {})
        .get("gamma", {})
        .get("usableRate", 0.0)
    )
    recommendation = _recommendation_from_buckets(bucket_counts, gamma_rate=float(gamma_rate))

    return {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(UTC).isoformat(),
        "sourceSummaryPath": summary.get("outputPath"),
        "gammaUsableRate": gamma_rate,
        "failingGammaFilesCount": len(diagnoses),
        "failingGammaFiles": [diagnosis.to_dict() for diagnosis in diagnoses],
        "decisionSummary": {
            "nonRecoverableUnderCurrentStrategy": bucket_counts.get(
                "non_recoverable_under_current_strategy", 0
            ),
            "recoverableWithSmallTargetedImprovement": bucket_counts.get(
                "recoverable_with_small_targeted_improvement", 0
            ),
            "needsBroaderStrategyChange": bucket_counts.get("needs_broader_strategy_change", 0),
            "topFailureCategories": category_counts.most_common(8),
        },
        "recommendation": recommendation,
    }


def _recommendation_from_buckets(bucket_counts: Counter[str], *, gamma_rate: float) -> dict[str, Any]:
    recoverable = bucket_counts.get("recoverable_with_small_targeted_improvement", 0)
    broader = bucket_counts.get("needs_broader_strategy_change", 0)
    non_recoverable = bucket_counts.get("non_recoverable_under_current_strategy", 0)

    if recoverable == 0 and (broader > 0 or non_recoverable > 0):
        return {
            "continueEngineImprovementNow": False,
            "justification": (
                "No clearly recoverable small-rule Gamma cases remain; failures are at or beyond "
                "the current object-level boundary."
            ),
            "betaReadiness": (
                gamma_rate >= 0.6
                and broader + non_recoverable >= 1
                and "Gamma support is sufficient for scoped beta with explicit unsupported boundaries."
                or "Hold beta until usable rate and boundary confidence improve."
            ),
            "productBoundaryCopyHint": (
                "Supports repeated independent header/footer text and small repeated corner logos. "
                "Does not support background-baked, flattened, or non-independent watermark structures."
            ),
        }

    return {
        "continueEngineImprovementNow": True,
        "justification": (
            "At least one failing Gamma case appears recoverable with a narrow, low-risk change."
        ),
        "betaReadiness": (
            "Proceed with beta only after targeted recoverable cases are re-validated."
        ),
        "productBoundaryCopyHint": (
            "Current support remains object-level only; unsupported files are fail-safe."
        ),
    }


def _render_markdown_report(result: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Gamma Plateau Diagnosis")
    lines.append("")
    lines.append(f"- Generated: `{result.get('generatedAt')}`")
    lines.append(f"- Source summary: `{result.get('sourceSummaryPath')}`")
    lines.append(f"- Gamma usable rate: **{result.get('gammaUsableRate')}**")
    lines.append(f"- Failing Gamma files: **{result.get('failingGammaFilesCount')}**")
    lines.append("")

    lines.append("## Per-file Diagnosis")
    lines.append("")
    lines.append(
        "| filename | pages | targetFound | dominantUnsupported | classification | decisionBucket | categories | whyNotUsable |"
    )
    lines.append("| --- | ---: | --- | --- | --- | --- | --- | --- |")
    for item in result.get("failingGammaFiles", []):
        lines.append(
            "| {filename} | {pages} | {target} | {reasons} | {classification} | {bucket} | {categories} | {why} |".format(
                filename=item.get("filename", ""),
                pages=item.get("pages", 0),
                target="yes" if item.get("targetLogoFooterHeaderFound") else "no",
                reasons=";".join(item.get("dominantUnsupportedReasonCodes", [])),
                classification=item.get("classification", ""),
                bucket=item.get("decisionBucket", ""),
                categories=";".join(item.get("categories", [])),
                why=item.get("whyNotUsable", ""),
            )
        )
    lines.append("")

    decision = result.get("decisionSummary", {})
    lines.append("## Decision Summary")
    lines.append("")
    lines.append(
        f"- Non-recoverable under current strategy: **{decision.get('nonRecoverableUnderCurrentStrategy', 0)}**"
    )
    lines.append(
        f"- Recoverable with small targeted improvement: **{decision.get('recoverableWithSmallTargetedImprovement', 0)}**"
    )
    lines.append(
        f"- Needs broader strategy change: **{decision.get('needsBroaderStrategyChange', 0)}**"
    )
    lines.append("")
    lines.append("### Top Failure Categories")
    lines.append("")
    lines.append("| category | count |")
    lines.append("| --- | ---: |")
    for category, count in decision.get("topFailureCategories", []):
        lines.append(f"| {category} | {count} |")
    lines.append("")

    recommendation = result.get("recommendation", {})
    lines.append("## Recommendation")
    lines.append("")
    lines.append(
        f"- Continue engine improvement now: **{recommendation.get('continueEngineImprovementNow')}**"
    )
    lines.append(f"- Justification: {recommendation.get('justification')}")
    lines.append(f"- Beta readiness: {recommendation.get('betaReadiness')}")
    lines.append(f"- Product boundary copy hint: {recommendation.get('productBoundaryCopyHint')}")
    lines.append("")

    return "\n".join(lines) + "\n"


def _flatten_candidates(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for candidates in analysis.get("candidatesByPage", {}).values():
        out.extend(candidates)
    return out


if __name__ == "__main__":
    raise SystemExit(main())

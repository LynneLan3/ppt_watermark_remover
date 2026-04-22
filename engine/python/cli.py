"""CLI for local text_run/image_xobject PDF object-removal MVP."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from editing.object_remover import RemovalError, apply_removal_plan
from models.plan import (
    PlanValidationError,
    ensure_plan_supported_for_apply,
    load_plan,
)
from parsers.pdf_objects import analysis_result_to_dict, analyze_pdf_candidates
from verification.visual_diff import build_failure_report, build_verification_report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf-object-removal",
        description=(
            "Local object-removal engine MVP. This round supports repeated text_run "
            "and narrow image_xobject removal only."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    analyze_parser = subparsers.add_parser(
        "analyze",
        help="Analyze a PDF and export object candidate + repeat-group JSON.",
    )
    analyze_parser.add_argument("--input", type=Path, required=True, help="Input PDF path.")
    analyze_parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Output analysis JSON path.",
    )

    apply_parser = subparsers.add_parser(
        "apply-plan",
        help="Apply a plan JSON to input PDF and export output PDF + verification report.",
    )
    apply_parser.add_argument("--input", type=Path, required=True, help="Input PDF path.")
    apply_parser.add_argument("--plan", type=Path, required=True, help="Plan JSON path.")
    apply_parser.add_argument("--output", type=Path, required=True, help="Output PDF path.")
    apply_parser.add_argument(
        "--report",
        type=Path,
        required=True,
        help="Verification report JSON path.",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "analyze":
        return run_analyze(args.input, args.output)

    if args.command == "apply-plan":
        return run_apply_plan(args.input, args.plan, args.output, args.report)

    parser.error("Unknown command")
    return 2


def run_analyze(input_pdf: Path, output_json: Path) -> int:
    result = analyze_pdf_candidates(input_pdf)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(
            analysis_result_to_dict(result),
            indent=2,
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    print(f"[analyze] wrote analysis report: {output_json}")
    print(f"[analyze] total candidates: {result.total_candidates}")
    print(f"[analyze] repeat groups: {len(result.repeat_groups)}")
    return 0


def run_apply_plan(
    input_pdf: Path,
    plan_json: Path,
    output_pdf: Path,
    report_json: Path,
) -> int:
    output_pdf.parent.mkdir(parents=True, exist_ok=True)
    report_json.parent.mkdir(parents=True, exist_ok=True)

    try:
        plan = load_plan(plan_json)
        ensure_plan_supported_for_apply(plan)
        outcome = apply_removal_plan(input_pdf, output_pdf, plan)
        report = build_verification_report(plan=plan, plan_file=plan_json, outcome=outcome)
        report_json.write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        print(f"[apply-plan] success: output={output_pdf}")
        print(f"[apply-plan] report={report_json}")
        print(
            f"[apply-plan] objectType={outcome.object_type} "
            f"matched={outcome.matched_objects_count} removed={outcome.removed_objects_count}"
        )
        return 0
    except (PlanValidationError, RemovalError) as error:
        try:
            plan = load_plan(plan_json)
            report = build_failure_report(
                plan=plan,
                plan_file=plan_json,
                input_file=input_pdf,
                output_file=output_pdf,
                failure_reason=str(error),
                unsupported_flags=["fail_safe_abort"],
            )
        except Exception:
            report = {
                "success": False,
                "inputFile": str(input_pdf),
                "outputFile": str(output_pdf),
                "planFile": str(plan_json),
                "selectedCandidateId": None,
                "objectType": None,
                "selectedScope": {"mode": None, "targetPages": []},
                "affectedPages": [],
                "matchedObjectsCount": 0,
                "removedObjectsCount": 0,
                "warnings": [],
                "unsupportedFlags": ["invalid_plan"],
                "failureReason": str(error),
            }
        report_json.write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        print(f"[apply-plan] fail-safe abort: {error}")
        print(f"[apply-plan] failure report={report_json}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

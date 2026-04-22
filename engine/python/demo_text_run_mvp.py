"""Reproducible local demo for text_run engine MVP.

Runs:
1) fixture generation
2) analyze (header fixture)
3) apply-plan (header fixture)

Outputs to: engine/python/demo_outputs/
"""

from __future__ import annotations

import json
from pathlib import Path

from cli import run_analyze, run_apply_plan
from parsers.pdf_objects import analysis_result_to_dict, analyze_pdf_candidates
from tests.generate_fixtures import generate_all_fixtures
from tests.testutils import build_plan_from_candidate, pick_supported_candidate, write_json


def main() -> int:
    root = Path(__file__).resolve().parent
    fixtures_dir = root / "tests" / "fixtures"
    outputs_dir = root / "demo_outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)

    fixtures = generate_all_fixtures(fixtures_dir)

    input_pdf = fixtures["header"]
    analysis_json = outputs_dir / "header.analysis.json"
    plan_json = outputs_dir / "header.plan.json"
    output_pdf = outputs_dir / "header.output.pdf"
    report_json = outputs_dir / "header.report.json"

    print(f"[demo] input fixture: {input_pdf}")
    run_analyze(input_pdf, analysis_json)

    analysis = analysis_result_to_dict(analyze_pdf_candidates(input_pdf))
    candidate = pick_supported_candidate(
        analysis,
        object_type="text_run",
        contains_text="HEADER_TEXT_WATERMARK",
    )
    plan = build_plan_from_candidate(
        source_file_name=input_pdf.name,
        candidate=candidate,
        target_pages=[1, 2, 3, 4],
    )
    write_json(plan_json, plan)

    rc = run_apply_plan(input_pdf, plan_json, output_pdf, report_json)

    print(f"[demo] analysis: {analysis_json}")
    print(f"[demo] plan: {plan_json}")
    print(f"[demo] output pdf: {output_pdf}")
    print(f"[demo] report: {report_json}")

    if report_json.exists():
        report = json.loads(report_json.read_text(encoding="utf-8"))
        print(
            "[demo] summary: "
            f"success={report.get('success')} "
            f"matched={report.get('matchedObjectsCount')} "
            f"removed={report.get('removedObjectsCount')}"
        )

    return rc


if __name__ == "__main__":
    raise SystemExit(main())

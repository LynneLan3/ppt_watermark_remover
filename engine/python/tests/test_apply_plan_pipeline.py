from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cli import run_apply_plan
from parsers.pdf_objects import analysis_result_to_dict, analyze_pdf_candidates
from tests.generate_fixtures import generate_all_fixtures
from tests.testutils import (
    build_plan_from_candidate,
    pick_supported_candidate,
    write_json,
)


class ApplyPlanPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixtures_dir = Path(__file__).parent / "fixtures"
        cls.fixtures = generate_all_fixtures(cls.fixtures_dir)

    def test_apply_plan_on_repeated_header_text_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            analysis = analysis_result_to_dict(analyze_pdf_candidates(self.fixtures["header"]))
            candidate = pick_supported_candidate(
                analysis,
                object_type="text_run",
                contains_text="HEADER_TEXT_WATERMARK",
            )

            plan = build_plan_from_candidate(
                source_file_name=self.fixtures["header"].name,
                candidate=candidate,
                target_pages=[1, 2, 3, 4],
            )

            plan_path = tmp / "header.plan.json"
            output_pdf = tmp / "header.out.pdf"
            report_path = tmp / "header.report.json"
            write_json(plan_path, plan)

            rc = run_apply_plan(self.fixtures["header"], plan_path, output_pdf, report_path)
            self.assertEqual(rc, 0)
            self.assertTrue(output_pdf.exists())
            self.assertTrue(report_path.exists())

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertTrue(report["success"])
            self.assertEqual(report["objectType"], "text_run")
            self.assertGreaterEqual(report["matchedObjectsCount"], 1)
            self.assertGreaterEqual(report["removedObjectsCount"], 1)

    def test_apply_plan_on_repeated_footer_text_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            analysis = analysis_result_to_dict(analyze_pdf_candidates(self.fixtures["footer"]))
            candidate = pick_supported_candidate(
                analysis,
                object_type="text_run",
                contains_text="FOOTER_TEXT_WATERMARK",
            )

            plan = build_plan_from_candidate(
                source_file_name=self.fixtures["footer"].name,
                candidate=candidate,
                target_pages=[1, 2, 3, 4],
            )

            plan_path = tmp / "footer.plan.json"
            output_pdf = tmp / "footer.out.pdf"
            report_path = tmp / "footer.report.json"
            write_json(plan_path, plan)

            rc = run_apply_plan(self.fixtures["footer"], plan_path, output_pdf, report_path)
            self.assertEqual(rc, 0)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertTrue(report["success"])
            self.assertEqual(report["selectedScope"]["mode"], "all")

    def test_apply_plan_on_repeated_corner_logo_image_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            analysis = analysis_result_to_dict(
                analyze_pdf_candidates(self.fixtures["image_corner_logo"])
            )
            candidate = pick_supported_candidate(analysis, object_type="image_xobject")

            plan = build_plan_from_candidate(
                source_file_name=self.fixtures["image_corner_logo"].name,
                candidate=candidate,
                target_pages=[1, 2, 3, 4],
            )

            plan_path = tmp / "corner-logo.plan.json"
            output_pdf = tmp / "corner-logo.out.pdf"
            report_path = tmp / "corner-logo.report.json"
            write_json(plan_path, plan)

            rc = run_apply_plan(
                self.fixtures["image_corner_logo"],
                plan_path,
                output_pdf,
                report_path,
            )
            self.assertEqual(rc, 0)

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertTrue(report["success"])
            self.assertEqual(report["objectType"], "image_xobject")
            self.assertGreaterEqual(report["matchedObjectsCount"], 1)
            self.assertGreaterEqual(report["removedObjectsCount"], 1)

    def test_unsupported_full_page_image_case_fails_safely(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            analysis = analysis_result_to_dict(
                analyze_pdf_candidates(self.fixtures["image_unsupported_full_page"])
            )

            first_page = sorted(analysis["candidatesByPage"], key=lambda p: int(p))[0]
            image_candidates = [
                candidate
                for candidate in analysis["candidatesByPage"][first_page]
                if candidate.get("objectType") == "image_xobject"
            ]
            self.assertTrue(image_candidates, "expected at least one image candidate")
            candidate = image_candidates[0]

            plan = build_plan_from_candidate(
                source_file_name=self.fixtures["image_unsupported_full_page"].name,
                candidate=candidate,
                target_pages=[1, 2, 3],
                removability="supported",  # force plan-level pass; engine should still fail-safe.
            )

            plan_path = tmp / "unsupported-full-image.plan.json"
            output_pdf = tmp / "unsupported-full-image.out.pdf"
            report_path = tmp / "unsupported-full-image.report.json"
            write_json(plan_path, plan)

            rc = run_apply_plan(
                self.fixtures["image_unsupported_full_page"],
                plan_path,
                output_pdf,
                report_path,
            )
            self.assertEqual(rc, 1)
            self.assertTrue(report_path.exists())

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertFalse(report["success"])
            self.assertIn("fail_safe_abort", report.get("unsupportedFlags", []))
            self.assertIsInstance(report.get("failureReason"), str)

    def test_unsupported_non_repeated_text_case_fails_safely(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            analysis = analysis_result_to_dict(
                analyze_pdf_candidates(self.fixtures["unsupported_non_repeated"])
            )

            first_page = sorted(analysis["candidatesByPage"], key=lambda p: int(p))[0]
            candidate = analysis["candidatesByPage"][first_page][0]

            plan = build_plan_from_candidate(
                source_file_name=self.fixtures["unsupported_non_repeated"].name,
                candidate=candidate,
                target_pages=[1, 2, 3, 4],
                removability="unsupported",
            )

            plan_path = tmp / "unsupported.plan.json"
            output_pdf = tmp / "unsupported.out.pdf"
            report_path = tmp / "unsupported.report.json"
            write_json(plan_path, plan)

            rc = run_apply_plan(
                self.fixtures["unsupported_non_repeated"],
                plan_path,
                output_pdf,
                report_path,
            )
            self.assertEqual(rc, 1)
            self.assertTrue(report_path.exists())

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertFalse(report["success"])
            self.assertIn("fail_safe_abort", report.get("unsupportedFlags", []))


if __name__ == "__main__":
    unittest.main()

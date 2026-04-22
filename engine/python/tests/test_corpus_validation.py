from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import json

from tests.generate_fixtures import generate_all_fixtures
from validation.corpus_validation import (
    build_summary,
    collect_samples,
    parse_source_types,
    resolve_output_json_path,
    validate_single_file,
    write_csv_summary,
    write_markdown_summary,
)


class CorpusValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixtures_dir = Path(__file__).parent / "fixtures"
        cls.fixtures = generate_all_fixtures(cls.fixtures_dir)

    def test_validate_single_file_generates_supported_result_for_corner_logo_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            result = validate_single_file(
                self.fixtures["image_corner_logo"],
                Path(tmpdir),
            )
            self.assertIn(result.source_type, {"other", "gamma", "notebooklm"})
            self.assertGreaterEqual(result.pages, 1)
            self.assertGreaterEqual(result.candidate_count, 1)
            self.assertGreaterEqual(result.supported_candidate_count, 1)
            self.assertTrue(result.target_logo_footer_header_found)
            self.assertTrue(result.cleaned_output_produced)
            self.assertTrue(result.usable)

    def test_summary_contains_required_totals(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            first = validate_single_file(self.fixtures["header"], Path(tmpdir) / "run-a")
            second = validate_single_file(
                self.fixtures["image_unsupported_full_page"],
                Path(tmpdir) / "run-b",
            )
            summary = build_summary(
                samples_root=self.fixtures_dir,
                output_path=Path(tmpdir) / "summary.json",
                file_results=[first, second],
                selected_source_types=["other"],
                mode="analyze-apply",
            )
            self.assertEqual(summary["schemaVersion"], "1.0")
            self.assertEqual(summary["totals"]["totalFiles"], 2)
            self.assertIn("usableFiles", summary["totals"])
            self.assertIn("cleanedOutputFiles", summary["totals"])
            self.assertIn("unsupportedFiles", summary["totals"])
            self.assertIn("aggregate", summary)
            self.assertIn("prioritization", summary)
            self.assertIn("supportedCandidateRateBySourceType", summary["aggregate"])
            self.assertEqual(len(summary["files"]), 2)

    def test_csv_and_markdown_outputs_are_generated(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            first = validate_single_file(self.fixtures["header"], tmp / "run-a")
            second = validate_single_file(
                self.fixtures["image_unsupported_full_page"],
                tmp / "run-b",
            )
            summary = build_summary(
                samples_root=self.fixtures_dir,
                output_path=tmp / "summary.json",
                file_results=[first, second],
                selected_source_types=["other"],
                mode="analyze-apply",
            )
            csv_path = tmp / "summary.csv"
            md_path = tmp / "summary.md"
            write_csv_summary([first, second], csv_path)
            write_markdown_summary(summary, md_path)

            self.assertTrue(csv_path.exists())
            self.assertTrue(md_path.exists())

            csv_text = csv_path.read_text(encoding="utf-8")
            self.assertIn("sourceType,filename,pages", csv_text)
            self.assertIn(first.filename, csv_text)

            md_text = md_path.read_text(encoding="utf-8")
            self.assertIn("# Gamma / NotebookLM Validation Summary", md_text)
            self.assertIn("Top Unsupported Reason Codes", md_text)

            (tmp / "summary.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self.assertTrue((tmp / "summary.json").exists())

    def test_source_type_parsing_and_sample_collection(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "gamma").mkdir(parents=True, exist_ok=True)
            (root / "notebooklm").mkdir(parents=True, exist_ok=True)
            (root / "other").mkdir(parents=True, exist_ok=True)
            (root / "gamma" / "a.pdf").write_bytes(b"%PDF-1.4")
            (root / "notebooklm" / "b.pdf").write_bytes(b"%PDF-1.4")
            (root / "other" / "c.pdf").write_bytes(b"%PDF-1.4")

            source_types = parse_source_types("gamma,notebooklm")
            self.assertEqual(source_types, ["gamma", "notebooklm"])
            samples = collect_samples(
                samples_root=root,
                source_types=source_types,
                max_files=0,
            )
            self.assertEqual(len(samples), 2)
            self.assertEqual(samples[0][0], "gamma")
            self.assertEqual(samples[1][0], "notebooklm")

    def test_output_path_resolution(self) -> None:
        root = Path("/tmp")
        self.assertEqual(
            resolve_output_json_path(root / "baseline", None),
            root / "baseline.json",
        )
        self.assertEqual(
            resolve_output_json_path(root / "baseline.json", None),
            root / "baseline.json",
        )
        self.assertEqual(
            resolve_output_json_path(root / "baseline", root / "legacy.json"),
            root / "legacy.json",
        )


if __name__ == "__main__":
    unittest.main()

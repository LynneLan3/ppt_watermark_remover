from __future__ import annotations

import unittest
from pathlib import Path

from parsers.pdf_objects import analysis_result_to_dict, analyze_pdf_candidates
from tests.generate_fixtures import generate_all_fixtures


class AnalysisPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixtures_dir = Path(__file__).parent / "fixtures"
        cls.fixtures = generate_all_fixtures(cls.fixtures_dir)

    def test_analyze_repeated_header_text_fixture(self) -> None:
        result = analyze_pdf_candidates(self.fixtures["header"])
        payload = analysis_result_to_dict(result)

        self.assertGreaterEqual(payload["totalCandidates"], 4)
        self.assertTrue(
            any(group["repeatCount"] >= 2 for group in payload["repeatGroups"]),
            "expected at least one repeated group",
        )
        self.assertTrue(
            any(
                group["objectType"] == "text_run"
                and "header_text_watermark" in group["normalizedText"]
                and group.get("placementHint") == "header"
                and group.get("reasonCode") == "repeated_header_text_supported"
                for group in payload["repeatGroups"]
            ),
            "expected repeated header marker text group",
        )

    def test_analyze_repeated_footer_text_fixture(self) -> None:
        result = analyze_pdf_candidates(self.fixtures["footer"])
        payload = analysis_result_to_dict(result)

        self.assertGreaterEqual(payload["totalPages"], 4)
        self.assertTrue(
            any(
                group["objectType"] == "text_run"
                and "footer_text_watermark" in group["normalizedText"]
                and group["repeatCount"] >= 2
                and group.get("placementHint") == "footer"
                and group.get("reasonCode") == "repeated_footer_text_supported"
                for group in payload["repeatGroups"]
            ),
            "expected repeated footer marker text group",
        )

    def test_analyze_repeated_corner_logo_image_fixture(self) -> None:
        result = analyze_pdf_candidates(self.fixtures["image_corner_logo"])
        payload = analysis_result_to_dict(result)

        self.assertTrue(
            any(
                group["objectType"] == "image_xobject"
                and group["repeatCount"] >= 2
                and group["removability"] == "supported"
                and group.get("reasonCode") == "repeated_corner_logo_supported"
                and group.get("placementHint") == "corner"
                for group in payload["repeatGroups"]
            ),
            "expected supported repeated image_xobject group for corner logo",
        )

    def test_analyze_repeated_small_brand_icon_fixture(self) -> None:
        result = analyze_pdf_candidates(self.fixtures["image_small_brand_icon"])
        payload = analysis_result_to_dict(result)

        self.assertTrue(
            any(
                group["objectType"] == "image_xobject"
                and group["repeatCount"] >= 2
                and group.get("reasonCode") == "repeated_corner_logo_supported"
                for group in payload["repeatGroups"]
            ),
            "expected repeated image_xobject group for small brand icon",
        )

    def test_analyze_output_is_deterministic_for_same_fixture(self) -> None:
        first = analysis_result_to_dict(analyze_pdf_candidates(self.fixtures["brand"]))
        second = analysis_result_to_dict(analyze_pdf_candidates(self.fixtures["brand"]))
        self.assertEqual(first, second)

    def test_analyze_large_background_image_exposes_explicit_reason(self) -> None:
        result = analyze_pdf_candidates(self.fixtures["image_unsupported_full_page"])
        payload = analysis_result_to_dict(result)

        self.assertTrue(
            any(
                group["objectType"] == "image_xobject"
                and group["removability"] == "unsupported"
                and group.get("reasonCode") == "large_background_image"
                for group in payload["repeatGroups"]
            ),
            "expected explicit large_background_image reason code",
        )


if __name__ == "__main__":
    unittest.main()

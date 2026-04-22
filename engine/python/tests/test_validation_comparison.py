from __future__ import annotations

import unittest

from validation.compare_validation_runs import build_comparison


class ValidationComparisonTests(unittest.TestCase):
    def test_build_comparison_detects_improvement_and_recommendation_delta(self) -> None:
        before = {
            "outputPath": "before.json",
            "generatedAt": "2026-01-01T00:00:00Z",
            "aggregate": {
                "usableRateBySourceType": {"gamma": {"usableRate": 0.5}, "notebooklm": {"usableRate": 0.0}},
                "usableFilesBySourceType": {"gamma": 1, "notebooklm": 0},
                "unsupportedReasonDistributionBySourceType": {"gamma": {"unsupported_structure": 2}},
                "supportedReasonDistributionBySourceType": {"gamma": {"repeated_header_text_supported": 1}},
                "topSupportedReasonCodes": [["repeated_header_text_supported", 1]],
            },
            "files": [
                {
                    "sourceType": "gamma",
                    "filename": "a.pdf",
                    "usable": False,
                    "selectedCandidateId": None,
                }
            ],
        }
        after = {
            "outputPath": "after.json",
            "generatedAt": "2026-01-02T00:00:00Z",
            "aggregate": {
                "usableRateBySourceType": {"gamma": {"usableRate": 1.0}, "notebooklm": {"usableRate": 0.0}},
                "usableFilesBySourceType": {"gamma": 2, "notebooklm": 0},
                "unsupportedReasonDistributionBySourceType": {"gamma": {"unsupported_structure": 1}},
                "supportedReasonDistributionBySourceType": {"gamma": {"repeated_header_text_supported": 2}},
                "topSupportedReasonCodes": [["repeated_header_text_supported", 2]],
            },
            "files": [
                {
                    "sourceType": "gamma",
                    "filename": "a.pdf",
                    "usable": True,
                    "selectedCandidateId": "text-run-1-0",
                }
            ],
        }

        comparison = build_comparison(before=before, after=after)
        self.assertEqual(comparison["delta"]["usableRateBySourceType"]["gamma"], 0.5)
        self.assertEqual(comparison["delta"]["usableFilesBySourceType"]["gamma"], 1)
        self.assertEqual(len(comparison["fileTransitions"]["improvedUnusableToUsable"]), 1)
        self.assertEqual(
            comparison["recommendationQuality"]["delta"]["gamma"]["recommendedCandidateUsableHitCountDelta"],
            1.0,
        )


if __name__ == "__main__":
    unittest.main()

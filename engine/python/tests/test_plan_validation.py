from __future__ import annotations

import unittest

from models.plan import (
    PlanValidationError,
    ensure_plan_supported_for_apply,
    ensure_plan_supported_for_text_removal,
    parse_plan_dict,
)


class PlanValidationTests(unittest.TestCase):
    def test_rejects_non_supported_object_plan(self) -> None:
        payload = {
            "planVersion": "1.0",
            "createdAt": "2026-04-20T00:00:00Z",
            "sourceFileName": "sample.pdf",
            "selectedCandidate": {
                "id": "c1",
                "pageNumber": 1,
                "objectType": "form_xobject",
                "label": "logo",
                "repeatKey": "k",
                "confidence": 0.9,
                "removability": "supported",
            },
            "scope": {
                "mode": "all",
                "targetPages": [1],
                "strategy": "all_matching_repeat_key",
            },
        }

        plan = parse_plan_dict(payload)
        with self.assertRaises(PlanValidationError):
            ensure_plan_supported_for_apply(plan)

    def test_requires_plan_version(self) -> None:
        with self.assertRaises(PlanValidationError):
            parse_plan_dict({})

    def test_accepts_supported_text_plan(self) -> None:
        payload = {
            "planVersion": "1.0",
            "createdAt": "2026-04-20T00:00:00Z",
            "sourceFileName": "sample.pdf",
            "selectedCandidate": {
                "id": "c1",
                "pageNumber": 1,
                "objectType": "text_run",
                "label": "header",
                "repeatKey": "text_run:header:0.10:0.05:0.25:0.05",
                "confidence": 0.8,
                "removability": "supported",
            },
            "scope": {
                "mode": "all",
                "targetPages": [1, 2],
                "strategy": "all_matching_repeat_key",
            },
        }

        plan = parse_plan_dict(payload)
        ensure_plan_supported_for_text_removal(plan)

    def test_accepts_supported_image_plan(self) -> None:
        payload = {
            "planVersion": "1.0",
            "createdAt": "2026-04-20T00:00:00Z",
            "sourceFileName": "sample.pdf",
            "selectedCandidate": {
                "id": "c2",
                "pageNumber": 1,
                "objectType": "image_xobject",
                "label": "corner logo",
                "repeatKey": "image_xobject:img:12:120x60:DeviceRGB:0.90:0.02:0.08:0.05",
                "confidence": 0.82,
                "removability": "supported",
                "imageIdentityKey": "img:12:120x60:DeviceRGB",
                "resourceName": "img:12:120x60:DeviceRGB",
            },
            "scope": {
                "mode": "all",
                "targetPages": [1, 2],
                "strategy": "all_matching_repeat_key",
            },
        }

        plan = parse_plan_dict(payload)
        object_type = ensure_plan_supported_for_apply(plan)
        self.assertEqual(object_type, "image_xobject")


if __name__ == "__main__":
    unittest.main()

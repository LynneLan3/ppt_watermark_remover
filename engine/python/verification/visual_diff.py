"""Verification report utilities for apply-plan."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pikepdf

from editing.object_remover import RemovalOutcome
from models.plan import RemovalPlan


def build_verification_report(
    *,
    plan: RemovalPlan,
    plan_file: Path,
    outcome: RemovalOutcome,
) -> dict[str, Any]:
    input_meta = _pdf_meta(Path(outcome.input_file))
    output_meta = _pdf_meta(Path(outcome.output_file)) if outcome.success else None

    return {
        "success": outcome.success,
        "inputFile": outcome.input_file,
        "outputFile": outcome.output_file,
        "planFile": str(plan_file),
        "selectedCandidateId": outcome.selected_candidate_id,
        "objectType": outcome.object_type,
        "selectedScope": {
            "mode": outcome.scope_mode,
            "targetPages": outcome.target_pages,
        },
        "affectedPages": outcome.affected_pages,
        "matchedObjectsCount": outcome.matched_objects_count,
        "removedObjectsCount": outcome.removed_objects_count,
        "warnings": outcome.warnings,
        "unsupportedFlags": outcome.unsupported_flags,
        "failureReason": outcome.failure_reason,
        "beforeTextObjectCountByPage": outcome.before_text_objects_by_page,
        "afterTextObjectCountByPage": outcome.after_text_objects_by_page,
        "beforeImageObjectCountByPage": outcome.before_image_objects_by_page,
        "afterImageObjectCountByPage": outcome.after_image_objects_by_page,
        "plan": {
            "planVersion": plan.plan_version,
            "sourceFileName": plan.source_file_name,
            "candidateRepeatKey": plan.selected_candidate.repeat_key,
            "preferredEngines": list(plan.preferred_engines),
            "notes": list(plan.notes),
            "engineHints": list(plan.engine_hints),
        },
        "pdfMeta": {
            "input": input_meta,
            "output": output_meta,
        },
    }


def build_failure_report(
    *,
    plan: RemovalPlan,
    plan_file: Path,
    input_file: Path,
    output_file: Path,
    failure_reason: str,
    unsupported_flags: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "success": False,
        "inputFile": str(input_file),
        "outputFile": str(output_file),
        "planFile": str(plan_file),
        "selectedCandidateId": plan.selected_candidate.id,
        "objectType": plan.selected_candidate.object_type,
        "selectedScope": {
            "mode": plan.scope.mode,
            "targetPages": list(plan.scope.target_pages),
        },
        "affectedPages": [],
        "matchedObjectsCount": 0,
        "removedObjectsCount": 0,
        "warnings": [],
        "unsupportedFlags": unsupported_flags or [],
        "failureReason": failure_reason,
        "beforeTextObjectCountByPage": {},
        "afterTextObjectCountByPage": {},
        "beforeImageObjectCountByPage": {},
        "afterImageObjectCountByPage": {},
        "plan": {
            "planVersion": plan.plan_version,
            "sourceFileName": plan.source_file_name,
            "candidateRepeatKey": plan.selected_candidate.repeat_key,
            "preferredEngines": list(plan.preferred_engines),
            "notes": list(plan.notes),
            "engineHints": list(plan.engine_hints),
        },
        "pdfMeta": {
            "input": _pdf_meta(input_file),
            "output": None,
        },
    }


def _pdf_meta(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None

    with pikepdf.open(path) as pdf:
        return {
            "pageCount": len(pdf.pages),
            "pdfVersion": pdf.pdf_version,
            "isEncrypted": bool(pdf.is_encrypted),
            "fileSizeBytes": path.stat().st_size,
        }

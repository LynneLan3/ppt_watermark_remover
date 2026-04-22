"""Plan model and validation for object-removal handoff JSON.

This round supports text_run and narrow image_xobject removal.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

SUPPORTED_PLAN_VERSION = "1.0"
SUPPORTED_OBJECT_TYPES = {"text_run", "image_xobject"}


class PlanValidationError(ValueError):
    """Raised when a plan JSON is invalid for this engine round."""


@dataclass(frozen=True)
class CandidateRef:
    id: str
    page_number: int
    object_type: str
    label: str
    repeat_key: str
    confidence: float
    removability: str
    resource_name: str | None
    image_identity_key: str | None


@dataclass(frozen=True)
class ScopeRef:
    mode: str
    target_pages: tuple[int, ...]
    strategy: str


@dataclass(frozen=True)
class RemovalPlan:
    plan_version: str
    created_at: str
    source_file_name: str
    selected_candidate: CandidateRef
    scope: ScopeRef
    preferred_engines: tuple[str, ...]
    preservation_goal: str
    engine_hints: tuple[str, ...]
    risk_level: str
    notes: tuple[str, ...]


def load_plan(path: Path) -> RemovalPlan:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return parse_plan_dict(raw)


def parse_plan_dict(raw: dict[str, Any]) -> RemovalPlan:
    _require(raw, "planVersion", str)
    _require(raw, "createdAt", str)
    _require(raw, "sourceFileName", str)
    _require(raw, "selectedCandidate", dict)
    _require(raw, "scope", dict)

    if raw["planVersion"] != SUPPORTED_PLAN_VERSION:
        raise PlanValidationError(
            f"Unsupported planVersion={raw['planVersion']!r}; expected {SUPPORTED_PLAN_VERSION!r}."
        )

    selected = _parse_candidate(raw["selectedCandidate"])
    scope = _parse_scope(raw["scope"])

    preferred_engines = tuple(raw.get("preferredEngines", ()))
    for engine in preferred_engines:
        if not isinstance(engine, str):
            raise PlanValidationError("preferredEngines must contain strings.")

    engine_hints = tuple(_ensure_string_list(raw.get("engineHints", []), "engineHints"))
    notes = tuple(_ensure_string_list(raw.get("notes", []), "notes"))

    return RemovalPlan(
        plan_version=raw["planVersion"],
        created_at=raw["createdAt"],
        source_file_name=raw["sourceFileName"],
        selected_candidate=selected,
        scope=scope,
        preferred_engines=preferred_engines,
        preservation_goal=str(raw.get("preservationGoal", "")),
        engine_hints=engine_hints,
        risk_level=str(raw.get("riskLevel", "")),
        notes=notes,
    )


def ensure_plan_supported_for_apply(plan: RemovalPlan) -> str:
    candidate = plan.selected_candidate

    if candidate.object_type not in SUPPORTED_OBJECT_TYPES:
        raise PlanValidationError(
            "This engine round supports only text_run and image_xobject candidates; "
            f"got {candidate.object_type!r}."
        )

    if not candidate.repeat_key.strip():
        raise PlanValidationError("selectedCandidate.repeatKey is required.")

    if candidate.removability != "supported":
        raise PlanValidationError(
            "Plan candidate removability must be 'supported' for safe apply-plan in this round."
        )

    min_confidence = 0.55 if candidate.object_type == "text_run" else 0.6
    if candidate.confidence < min_confidence:
        raise PlanValidationError(
            f"Plan candidate confidence is too low for safe {candidate.object_type} removal (< {min_confidence})."
        )

    if candidate.object_type == "image_xobject" and not (
        (candidate.image_identity_key and candidate.image_identity_key.strip())
        or (candidate.resource_name and candidate.resource_name.strip())
    ):
        raise PlanValidationError(
            "image_xobject plan requires imageIdentityKey or resourceName for deterministic matching."
        )

    if not plan.scope.target_pages:
        raise PlanValidationError("scope.targetPages cannot be empty.")

    return candidate.object_type


def ensure_plan_supported_for_text_removal(plan: RemovalPlan) -> None:
    object_type = ensure_plan_supported_for_apply(plan)
    if object_type != "text_run":
        raise PlanValidationError(f"Expected text_run plan, got {object_type!r}.")


def _parse_candidate(raw: dict[str, Any]) -> CandidateRef:
    _require(raw, "id", str)
    _require(raw, "pageNumber", int)
    _require(raw, "objectType", str)
    _require(raw, "label", str)
    _require(raw, "repeatKey", str)
    _require(raw, "confidence", (int, float))
    _require(raw, "removability", str)

    resource_name = raw.get("resourceName")
    if resource_name is not None and not isinstance(resource_name, str):
        raise PlanValidationError("selectedCandidate.resourceName must be a string when provided.")

    image_identity_key = raw.get("imageIdentityKey")
    if image_identity_key is not None and not isinstance(image_identity_key, str):
        raise PlanValidationError(
            "selectedCandidate.imageIdentityKey must be a string when provided."
        )

    return CandidateRef(
        id=raw["id"],
        page_number=raw["pageNumber"],
        object_type=raw["objectType"],
        label=raw["label"],
        repeat_key=raw["repeatKey"],
        confidence=float(raw["confidence"]),
        removability=raw["removability"],
        resource_name=resource_name,
        image_identity_key=image_identity_key,
    )


def _parse_scope(raw: dict[str, Any]) -> ScopeRef:
    _require(raw, "mode", str)
    _require(raw, "targetPages", list)
    _require(raw, "strategy", str)

    pages: list[int] = []
    for page in raw["targetPages"]:
        if not isinstance(page, int) or page < 1:
            raise PlanValidationError("scope.targetPages must contain positive integers.")
        pages.append(page)

    return ScopeRef(
        mode=raw["mode"],
        target_pages=tuple(sorted(set(pages))),
        strategy=raw["strategy"],
    )


def _require(raw: dict[str, Any], key: str, expected_type: Any) -> None:
    if key not in raw:
        raise PlanValidationError(f"Missing required field: {key}")
    if not isinstance(raw[key], expected_type):
        raise PlanValidationError(
            f"Field {key!r} has invalid type {type(raw[key]).__name__}; expected {expected_type}."
        )


def _ensure_string_list(values: Any, field_name: str) -> list[str]:
    if not isinstance(values, list):
        raise PlanValidationError(f"{field_name} must be a list.")
    out: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise PlanValidationError(f"{field_name} must contain strings.")
        out.append(value)
    return out

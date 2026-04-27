#!/usr/bin/env python3
"""Stage 2 process v2: object-level PDF cleanup with pikepdf."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Iterable

import pikepdf
from pikepdf import parse_content_stream, unparse_content_stream
from pdf_fingerprint import (
    build_exporter_fingerprint,
    build_structure_tags,
    build_template_page_signatures,
)
from vector_debug_buckets import summarize_vector_debug
from regression_replay_plan import build_regression_replay_plan


VECTOR_PATH_OPERATORS = {
    "m",
    "l",
    "c",
    "v",
    "y",
    "h",
    "re",
}
VECTOR_PAINT_OPERATORS = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n", "W", "W*"}
VECTOR_STATE_OPERATORS = {"cm", "w", "J", "j", "M", "d", "ri", "i", "gs", "RG", "G", "K", "rg", "g", "k"}
VECTOR_REMOVABLE_OPERATORS = VECTOR_PATH_OPERATORS | VECTOR_PAINT_OPERATORS | VECTOR_STATE_OPERATORS
TEXT_OPERATORS = {"Tj", "TJ", "'", '"'}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Process Stage2 PDF cleanup v2")
    parser.add_argument("--request", type=Path, required=True, help="Process request json path")
    parser.add_argument("--input", type=Path, required=True, help="Input PDF")
    parser.add_argument("--output", type=Path, required=True, help="Output PDF")
    parser.add_argument("--report", type=Path, required=True, help="Process report JSON")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return run_process(args.request, args.input, args.output, args.report)


def run_process(request_path: Path, input_pdf: Path, output_pdf: Path, report_path: Path) -> int:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    try:
        request = json.loads(request_path.read_text(encoding="utf-8"))
        candidates = {
            str(item.get("id")): item for item in request.get("candidates", []) if item.get("id")
        }
        selections = request.get("selection", [])
        previous_metrics = request.get("previousMetrics")
        execution_map_path_raw = request.get("executionMapPath")
        process_debug_path_raw = request.get("processDebugPath")
        process_debug_summary_path_raw = request.get("processDebugSummaryPath")
        regression_replay_plan_path_raw = request.get("regressionReplayPlanPath")
        regression_suite_manifest_path_raw = request.get("regressionSuiteManifestPath")
        page_commands_path_raw = request.get("pageCommandsPath")

        applied_operations: list[dict[str, Any]] = []
        skipped_operations: list[dict[str, Any]] = []
        candidate_attempts: dict[str, int] = {}
        candidate_hits: dict[str, int] = {}
        warnings: list[str] = []
        vector_debug: list[dict[str, Any]] = []

        execution_map_rows = build_execution_map(selections=selections, candidates=candidates)
        if isinstance(execution_map_path_raw, str) and execution_map_path_raw:
            execution_map_path = Path(execution_map_path_raw)
            execution_map_path.parent.mkdir(parents=True, exist_ok=True)
            execution_map_path.write_text(
                json.dumps(execution_map_rows, indent=2, ensure_ascii=False, sort_keys=True),
                encoding="utf-8",
            )

        exporter_fingerprint: dict[str, Any] = {
            "rawProducer": "unknown",
            "rawCreator": "unknown",
            "normalizedProducerFamily": "unknown",
            "normalizedCreatorFamily": "unknown",
            "exporterBucketId": "unknown_exporter",
            "objectStreamsEnabled": False,
            "compressedContentStreams": False,
        }
        template_profiles: dict[int, dict[str, Any]] = {}
        with pikepdf.open(input_pdf) as pdf:
            input_page_count = len(pdf.pages)
            exporter_fingerprint = build_exporter_fingerprint(pdf)
            page_commands_rows = read_page_commands_rows(page_commands_path_raw)
            template_profiles = build_template_page_signatures(
                page_commands=page_commands_rows,
                page_count=input_page_count,
            )

            for selection in selections:
                candidate_id = str(selection.get("candidateId", ""))
                candidate = candidates.get(candidate_id)
                if not candidate:
                    skipped_operations.append(
                        {
                            "candidateId": candidate_id,
                            "anchorId": "",
                            "page": -1,
                            "reason": "candidate_not_found",
                            "detail": {"stage": "precheck", "notes": ["candidate missing in request payload"]},
                        }
                    )
                    continue

                target_pages = expand_target_pages(candidate, selection)
                anchors = candidate.get("anchors", [])
                if not anchors:
                    skipped_operations.append(
                        {
                            "candidateId": candidate_id,
                            "anchorId": "",
                            "page": target_pages[0] if target_pages else -1,
                            "reason": "anchor_missing",
                            "detail": {"stage": "precheck", "notes": ["candidate has no anchors"]},
                        }
                    )
                    continue

                for anchor in anchors:
                    page_num = int(anchor.get("page", 0))
                    if page_num <= 0 or page_num not in target_pages:
                        continue
                    if page_num > len(pdf.pages):
                        skipped_operations.append(
                            {
                                "candidateId": candidate_id,
                                "anchorId": "",
                                "page": page_num,
                                "reason": "page_out_of_range",
                                "detail": {"stage": "precheck", "notes": ["anchor page out of range"]},
                            }
                        )
                        continue

                    try:
                        changed, outcome = apply_anchor_to_page(
                            pdf=pdf,
                            page=pdf.pages[page_num - 1],
                            candidate=candidate,
                            anchor=anchor,
                            candidate_id=candidate_id,
                        )
                        candidate_attempts[candidate_id] = candidate_attempts.get(candidate_id, 0) + 1
                        debug_entry = outcome.get("debug")
                        if isinstance(debug_entry, dict) and str(candidate.get("kind", "")) == "vector":
                            page_profile = template_profiles.get(page_num, {"templatePageSignature": "unknown"})
                            debug_entry["jobId"] = str(request.get("jobId", ""))
                            debug_entry["exporterBucketId"] = exporter_fingerprint.get(
                                "exporterBucketId", "unknown_exporter"
                            )
                            debug_entry["rawProducer"] = exporter_fingerprint.get("rawProducer", "unknown")
                            debug_entry["rawCreator"] = exporter_fingerprint.get("rawCreator", "unknown")
                            debug_entry["normalizedProducerFamily"] = exporter_fingerprint.get(
                                "normalizedProducerFamily", "unknown"
                            )
                            debug_entry["normalizedCreatorFamily"] = exporter_fingerprint.get(
                                "normalizedCreatorFamily", "unknown"
                            )
                            debug_entry["templatePageSignature"] = page_profile.get(
                                "templatePageSignature", "unknown_template"
                            )
                            debug_entry["pageLayoutProfile"] = page_profile
                            debug_entry["structureTags"] = build_structure_tags(
                                exporter_fingerprint=exporter_fingerprint,
                                page_profile=page_profile,
                            )
                            debug_entry["graphicsDepthBand"] = page_profile.get("graphicsDepthBand", "unknown")
                            debug_entry["spanShapeSignatureFamily"] = derive_span_family(
                                debug_entry.get("detail", {}).get("expected", {}).get("spanShapeSignature", "")
                            )
                            vector_debug.append(debug_entry)
                        if changed:
                            candidate_hits[candidate_id] = candidate_hits.get(candidate_id, 0) + 1
                            applied_operations.append(
                                {
                                    "candidateId": candidate_id,
                                    "anchorId": outcome.get("anchorId"),
                                    "operation": outcome["operation"],
                                    "page": page_num,
                                    "success": True,
                                    "detail": outcome.get("detail"),
                                }
                            )
                        else:
                            skipped_operations.append(
                                {
                                    "candidateId": candidate_id,
                                    "anchorId": outcome.get("anchorId"),
                                    "page": page_num,
                                    "reason": outcome["reason"],
                                    "detail": outcome.get("detail"),
                                }
                            )
                    except Exception as error:  # pylint: disable=broad-except
                        skipped_operations.append(
                            {
                                "candidateId": candidate_id,
                                "anchorId": build_anchor_id(candidate_id, anchor),
                                "page": page_num,
                                "reason": f"anchor_apply_error:{error}",
                                "detail": {
                                    "stage": "delete",
                                    "notes": [str(error)],
                                },
                            }
                        )

            # v2A cleanup hook: remove unreferenced resources if supported.
            if hasattr(pdf, "remove_unreferenced_resources"):
                try:
                    pdf.remove_unreferenced_resources()
                except Exception as error:  # pylint: disable=broad-except
                    warnings.append(f"remove_unreferenced_resources_failed:{error}")

            pdf.save(output_pdf)
            output_page_count = len(pdf.pages)

        process_debug_payload = {
            "jobId": str(request.get("jobId", "")),
            "processedAt": iso_now(),
            "exporterFingerprint": exporter_fingerprint,
            "vectorDebug": vector_debug,
        }
        process_debug_path = (
            Path(process_debug_path_raw)
            if isinstance(process_debug_path_raw, str) and process_debug_path_raw
            else report_path.with_name("process-debug.v1.json")
        )
        process_debug_path.parent.mkdir(parents=True, exist_ok=True)
        process_debug_path.write_text(
            json.dumps(process_debug_payload, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        summary_path = (
            Path(process_debug_summary_path_raw)
            if isinstance(process_debug_summary_path_raw, str) and process_debug_summary_path_raw
            else report_path.with_name("process-debug-summary.v1.json")
        )
        summary_payload = summarize_vector_debug(
            job_id=str(request.get("jobId", "")),
            processed_at=iso_now(),
            vector_debug=vector_debug,
        )
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(
            json.dumps(summary_payload, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        replay_plan, suite_manifest_payload = build_regression_replay_plan(
            summary_payload=summary_payload,
            debug_payload=process_debug_payload,
            process_report={
                "appliedOperations": applied_operations,
                "skippedOperations": skipped_operations,
            },
            artifact_paths={
                "summaryPath": str(summary_path),
                "pageCommandsPath": str(page_commands_path_raw or ""),
                "executionMapPath": str(execution_map_path_raw or ""),
                "processDebugPath": str(process_debug_path),
                "processReportPath": str(report_path),
            },
        )
        replay_plan_path = (
            Path(regression_replay_plan_path_raw)
            if isinstance(regression_replay_plan_path_raw, str) and regression_replay_plan_path_raw
            else report_path.with_name("regression-replay-plan.v1.json")
        )
        suite_manifest_path = (
            Path(regression_suite_manifest_path_raw)
            if isinstance(regression_suite_manifest_path_raw, str) and regression_suite_manifest_path_raw
            else report_path.with_name("regression-suite-manifest.v1.json")
        )
        replay_plan_path.parent.mkdir(parents=True, exist_ok=True)
        suite_manifest_path.parent.mkdir(parents=True, exist_ok=True)
        replay_plan_path.write_text(
            json.dumps(replay_plan, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        suite_manifest_path.write_text(
            json.dumps(suite_manifest_payload, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        bucket_metrics = build_bucket_diagnostics_metrics(summary_payload)

        current_metrics = build_quality_metrics(
            candidates=request.get("candidates", []),
            applied_operations=applied_operations,
            skipped_operations=skipped_operations,
            candidate_attempts=candidate_attempts,
            candidate_hits=candidate_hits,
        )
        report = {
            "processedAt": iso_now(),
            "selectedCandidates": selections,
            "appliedOperations": applied_operations,
            "skippedOperations": skipped_operations,
            "skippedReasons": count_reasons(skipped_operations),
            "inputPageCount": input_page_count,
            "outputPageCount": output_page_count,
            "warnings": warnings,
            "qualityMetrics": current_metrics,
            "metricsComparison": build_metrics_comparison(previous_metrics, current_metrics),
            "debugArtifactPath": str(process_debug_path),
            "debugSummaryPath": str(summary_path),
            "bucketDiagnosticsMetrics": bucket_metrics,
            "replayPlanPath": str(replay_plan_path),
            "suiteManifestPath": str(suite_manifest_path),
            "nextFixTargets": replay_plan.get("nextFixTargets", []),
        }
        report_path.write_text(
            json.dumps(report, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        return 0
    except Exception as error:  # pylint: disable=broad-except
        fatal_report = {
            "processedAt": iso_now(),
            "selectedCandidates": [],
            "appliedOperations": [],
            "skippedOperations": [],
            "skippedReasons": {},
            "inputPageCount": 0,
            "outputPageCount": 0,
            "warnings": [],
            "qualityMetrics": build_quality_metrics(
                candidates=[],
                applied_operations=[],
                skipped_operations=[],
                candidate_attempts={},
                candidate_hits={},
            ),
            "metricsComparison": None,
            "fatalError": str(error),
        }
        report_path.write_text(
            json.dumps(fatal_report, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        return 2


def apply_anchor_to_page(
    *,
    pdf: pikepdf.Pdf,
    page: pikepdf.Page,
    candidate: dict[str, Any],
    anchor: dict[str, Any],
    candidate_id: str,
) -> tuple[bool, dict[str, Any]]:
    strategy = str(anchor.get("removalStrategy", "no_reliable_anchor"))
    reliability = str(anchor.get("reliability", "weak"))
    operator_type = str(anchor.get("operatorType", ""))
    anchor_operator_name = str(anchor.get("operatorName", ""))
    resource_name = str(anchor.get("resourceName", ""))
    start = int(anchor.get("commandStart", -1))
    end = int(anchor.get("commandEnd", -1))
    graphics_depth = int(anchor.get("graphicsDepth", -1))
    path_start = int(anchor.get("pathStart", start))
    path_end = int(anchor.get("pathEnd", start))
    paint_start = int(anchor.get("paintStart", end))
    paint_end = int(anchor.get("paintEnd", end))
    span_shape_signature = str(anchor.get("spanShapeSignature", ""))
    expected_path_ops = [str(item) for item in anchor.get("pathOperators", []) if item]
    expected_paint_ops = [str(item) for item in anchor.get("paintOperators", []) if item]
    kind = str(candidate.get("kind", ""))
    candidate_safe_to_remove = bool(candidate.get("safeToRemove", False))
    candidate_reasons = [str(item) for item in candidate.get("reasons", []) if item]
    anchor_id = build_anchor_id(candidate_id, anchor)
    block_id = str(anchor.get("blockId", ""))

    if kind == "image" and not candidate_safe_to_remove:
        blocked_subtype = pick_image_blocked_subtype(candidate_reasons)
        blocked_reason = (
            "full_page_candidate_blocked"
            if blocked_subtype in {"full_page_slide_raster", "likely_page_background_image"}
            else "unsafe_candidate_blocked"
        )
        return False, {
            "anchorId": anchor_id,
            "reason": blocked_reason,
            "detail": {
                "stage": "precheck",
                "blockId": block_id,
                "subtype": blocked_subtype,
                "normalizedSubtype": normalize_image_skip_subtype(blocked_subtype, blocked_reason),
                "expected": {
                    "operatorType": operator_type,
                    "operatorName": anchor_operator_name,
                    "resourceName": resource_name,
                },
                "notes": [
                    "image candidate blocked by analyze safeToRemove policy",
                    ",".join(candidate_reasons),
                ],
            },
        }

    executable = should_execute_anchor(kind=kind, reliability=reliability)
    if not executable or strategy == "no_reliable_anchor":
        return False, {
            "anchorId": anchor_id,
            "reason": "anchor_unreliable",
            "detail": {
                "stage": "precheck",
                "blockId": block_id,
                "notes": ["anchor not executable by reliability policy"],
            },
        }
    if start < 0 or end < start:
        return False, {
            "anchorId": anchor_id,
            "reason": "span_shape_mismatch",
            "detail": {
                "stage": "precheck",
                "blockId": block_id,
                "subtype": "invalid_command_span",
                "expected": {
                    "commandStart": start,
                    "commandEnd": end,
                },
            },
        }

    instructions = list(parse_content_stream(page))
    depth_map = build_graphics_depth_map(instructions)
    precheck_ctx = build_vector_precheck_context(
        instructions=instructions,
        depth_map=depth_map,
        start=start,
        end=end,
        path_start=path_start,
        path_end=path_end,
        paint_start=paint_start,
        paint_end=paint_end,
        expected_path_ops=expected_path_ops,
        expected_paint_ops=expected_paint_ops,
        expected_signature=span_shape_signature,
        expected_depth=graphics_depth,
        block_id=block_id,
    )

    if end >= len(instructions):
        return False, {
            "anchorId": anchor_id,
            "reason": "span_shape_mismatch",
            "detail": enrich_skip_detail(
                precheck_ctx,
                stage="precheck",
                subtype="span_out_of_bounds",
                notes=["anchor end exceeds instruction length"],
            ),
            "debug": build_vector_debug_entry(
                candidate_id=candidate_id,
                anchor_id=anchor_id,
                page_num=int(anchor.get("page", -1)),
                block_id=block_id,
                precheck=precheck_ctx,
                delete_result={"status": "not_started"},
                postcheck={"status": "not_started"},
                final_status="skipped",
                core_reason="span_shape_mismatch",
                detail=enrich_skip_detail(
                    precheck_ctx,
                    stage="precheck",
                    subtype="span_out_of_bounds",
                    notes=["anchor end exceeds instruction length"],
                ),
            ),
        }

    valid, reason, reason_subtype, observed = validate_anchor_against_commands(
        precheck_ctx=precheck_ctx,
        operator_type=operator_type,
        operator_name=anchor_operator_name,
        resource_name=resource_name,
    )
    if not valid:
        detail = enrich_skip_detail(
            precheck_ctx,
            stage="precheck",
            subtype=reason_subtype,
            observed=observed,
            notes=[f"validation failed: {reason_subtype}"],
        )
        if kind == "image":
            detail["normalizedSubtype"] = normalize_image_skip_subtype(reason_subtype, reason)
        return False, {
            "anchorId": anchor_id,
            "reason": reason,
            "detail": detail,
            "debug": build_vector_debug_entry(
                candidate_id=candidate_id,
                anchor_id=anchor_id,
                page_num=int(anchor.get("page", -1)),
                block_id=block_id,
                precheck=precheck_ctx,
                delete_result={"status": "not_started"},
                postcheck={"status": "not_started"},
                final_status="skipped",
                core_reason=reason,
                detail=detail,
            ),
        }

    kept = []
    removed_count = 0
    removed_vector_path = 0
    removed_vector_paint = 0
    matched_block_range = 0
    before_count = len(instructions)

    for idx, instruction in enumerate(instructions):
        op_name = operator_name(instruction)
        operands = instruction_operands(instruction)
        should_remove = False

        if strategy == "remove_xobject_do_ops" or operator_type == "xobject_do":
            if op_name == "Do" and resource_name and operands:
                operand_name = normalize_resource_name(operands[-1])
                if operand_name == normalize_resource_name(resource_name):
                    should_remove = True
        elif strategy == "remove_vector_ops_by_range" or operator_type == "vector_paint":
            if (
                start >= 0
                and end >= start
                and start <= idx <= end
                and op_name in VECTOR_REMOVABLE_OPERATORS
                and graphics_depth >= 0
            ):
                should_remove = True
                matched_block_range += 1
        elif strategy == "remove_text_ops_by_range" or operator_type in {"text_show", "text_block"}:
            if start >= 0 and end >= start and start <= idx <= end and op_name in TEXT_OPERATORS:
                should_remove = True

        if should_remove:
            removed_count += 1
            if op_name in VECTOR_PATH_OPERATORS:
                removed_vector_path += 1
            if op_name in VECTOR_PAINT_OPERATORS:
                removed_vector_paint += 1
            continue
        kept.append(instruction)

    delete_result = {
        "beforeCommandCount": before_count,
        "matchedBlockRangeCommandCount": matched_block_range,
        "removedCommandCount": removed_count,
        "removedPathCommandCount": removed_vector_path,
        "removedPaintCommandCount": removed_vector_paint,
    }
    if removed_count <= 0:
        zero_removed_subtype = (
            "delete_pass_removed_zero_commands"
            if kind == "image"
            else "delete_pass_removed_zero_commands"
        )
        detail = enrich_skip_detail(
            precheck_ctx,
            stage="delete",
            subtype=zero_removed_subtype,
            notes=["delete pass removed zero commands"],
            removed_command_count=0,
        )
        if kind == "image":
            detail["normalizedSubtype"] = normalize_image_skip_subtype(
                zero_removed_subtype, "no_instruction_removed"
            )
        return False, {
            "anchorId": anchor_id,
            "reason": "no_instruction_removed",
            "detail": detail,
            "debug": build_vector_debug_entry(
                candidate_id=candidate_id,
                anchor_id=anchor_id,
                page_num=int(anchor.get("page", -1)),
                block_id=block_id,
                precheck=precheck_ctx,
                delete_result=delete_result,
                postcheck={"status": "not_started"},
                final_status="skipped",
                core_reason="no_instruction_removed",
                detail=detail,
            ),
        }
    if operator_type == "vector_paint" and (removed_vector_path <= 0 or removed_vector_paint <= 0):
        subtype = (
            "delete_pass_left_residual_path"
            if removed_vector_path <= 0
            else "delete_pass_left_residual_paint"
        )
        detail = enrich_skip_detail(
            precheck_ctx,
            stage="delete",
            subtype=subtype,
            notes=["vector delete removed incomplete block segments"],
            removed_command_count=removed_count,
        )
        return False, {
            "anchorId": anchor_id,
            "reason": "no_instruction_removed",
            "detail": detail,
            "debug": build_vector_debug_entry(
                candidate_id=candidate_id,
                anchor_id=anchor_id,
                page_num=int(anchor.get("page", -1)),
                block_id=block_id,
                precheck=precheck_ctx,
                delete_result=delete_result,
                postcheck={"status": "not_started"},
                final_status="partial",
                core_reason="no_instruction_removed",
                detail=detail,
            ),
        }

    residual_path_count = 0
    residual_paint_count = 0
    for idx, instruction in enumerate(kept):
        if start <= idx <= end:
            op_name = operator_name(instruction)
            if op_name in VECTOR_PATH_OPERATORS:
                residual_path_count += 1
            if op_name in VECTOR_PAINT_OPERATORS:
                residual_paint_count += 1

    page.Contents = pikepdf.Stream(pdf, unparse_content_stream(kept))
    success_detail = {
        "stage": "postcheck",
        "blockId": block_id,
        "removedCommandCount": removed_count,
        "delete": {
            **delete_result,
            "residualPathCommandCount": residual_path_count,
            "residualPaintCommandCount": residual_paint_count,
        },
    }
    return True, {
        "anchorId": anchor_id,
        "operation": strategy,
        "detail": success_detail,
        "debug": build_vector_debug_entry(
            candidate_id=candidate_id,
            anchor_id=anchor_id,
            page_num=int(anchor.get("page", -1)),
            block_id=block_id,
            precheck=precheck_ctx,
            delete_result=delete_result,
            postcheck={
                "residualPathCommandCount": residual_path_count,
                "residualPaintCommandCount": residual_paint_count,
            },
            final_status="applied",
            core_reason="applied",
            detail=success_detail,
        ),
    }


def expand_target_pages(candidate: dict[str, Any], selection: dict[str, Any]) -> list[int]:
    mode = str(selection.get("applyMode", "current_page"))
    explicit_pages = normalize_pages(selection.get("explicitPages", []))
    candidate_pages = normalize_pages(candidate.get("pages", []))

    if mode == "page_range":
        return explicit_pages
    if mode == "all_repeated":
        return candidate_pages
    # current_page
    if explicit_pages:
        return explicit_pages[:1]
    return candidate_pages[:1]


def normalize_pages(values: Any) -> list[int]:
    if not isinstance(values, Iterable) or isinstance(values, (str, bytes, dict)):
        return []
    pages = []
    for value in values:
        try:
            page = int(value)
            if page > 0:
                pages.append(page)
        except Exception:  # pylint: disable=broad-except
            continue
    return sorted(set(pages))


def instruction_operands(instruction: Any) -> list[Any]:
    if hasattr(instruction, "operands"):
        ops = getattr(instruction, "operands")
        return list(ops if ops is not None else [])
    if isinstance(instruction, (tuple, list)) and len(instruction) >= 1:
        ops = instruction[0]
        if isinstance(ops, (tuple, list)):
            return list(ops)
        return [ops]
    return []


def operator_name(instruction: Any) -> str:
    operator = None
    if hasattr(instruction, "operator"):
        operator = getattr(instruction, "operator")
    elif isinstance(instruction, (tuple, list)) and len(instruction) >= 2:
        operator = instruction[1]
    if operator is None:
        return ""
    value = str(operator).strip()
    if value.startswith("/"):
        value = value[1:]
    return value


def normalize_resource_name(value: Any) -> str:
    text = str(value).strip()
    if text.startswith("/"):
        text = text[1:]
    return text


def count_reasons(skipped: list[dict[str, Any]]) -> dict[str, int]:
    result: dict[str, int] = {}
    for item in skipped:
        reason = str(item.get("reason", "unknown"))
        result[reason] = result.get(reason, 0) + 1
    return result


def build_execution_map(
    *, selections: list[dict[str, Any]], candidates: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for selection in selections:
        candidate_id = str(selection.get("candidateId", ""))
        candidate = candidates.get(candidate_id)
        if not candidate:
            continue
        for anchor in candidate.get("anchors", []):
            rows.append(
                {
                    "candidateId": candidate_id,
                    "page": int(anchor.get("page", -1)),
                    "commandStart": int(anchor.get("commandStart", -1)),
                    "commandEnd": int(anchor.get("commandEnd", -1)),
                    "pathStart": int(anchor.get("pathStart", -1)),
                    "pathEnd": int(anchor.get("pathEnd", -1)),
                    "paintStart": int(anchor.get("paintStart", -1)),
                    "paintEnd": int(anchor.get("paintEnd", -1)),
                    "operatorName": str(anchor.get("operatorName", "")),
                    "operatorType": str(anchor.get("operatorType", "")),
                    "resourceName": str(anchor.get("resourceName", "")),
                    "reliability": str(anchor.get("reliability", "")),
                    "anchorId": build_anchor_id(candidate_id, anchor),
                    "blockId": str(anchor.get("blockId", "")),
                    "spanShapeSignature": str(anchor.get("spanShapeSignature", "")),
                    "paintOperators": [str(item) for item in anchor.get("paintOperators", []) if item],
                    "pathOperators": [str(item) for item in anchor.get("pathOperators", []) if item],
                    "graphicsDepth": int(anchor.get("graphicsDepth", -1)),
                    "removalStrategy": str(anchor.get("removalStrategy", "")),
                }
            )
    return rows


def read_page_commands_rows(path_raw: Any) -> list[dict[str, Any]]:
    if not isinstance(path_raw, str) or not path_raw:
        return []
    path = Path(path_raw)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("pageCommands", [])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    except Exception:  # pylint: disable=broad-except
        return []
    return []


def derive_span_family(signature: str) -> str:
    if not signature:
        return "unknown_span_family"
    parts = [part for part in signature.split("|") if part.startswith("path:") or part.startswith("paint:")]
    return "|".join(parts[:2]) if parts else "unknown_span_family"


def build_bucket_diagnostics_metrics(summary_payload: dict[str, Any]) -> dict[str, Any]:
    exporter_buckets = summary_payload.get("exporterBuckets", [])
    template_buckets = summary_payload.get("templateBuckets", [])
    structure_buckets = summary_payload.get("structureBuckets", [])
    return {
        "topExporterBucketBySkipCount": pick_bucket_id(exporter_buckets, "skipCount"),
        "topExporterBucketBySpanShapeMismatch": pick_bucket_id_by_reason(
            exporter_buckets, reason="span_shape_mismatch"
        ),
        "topTemplateBucketByMissingPathSegment": pick_bucket_id_by_subtype(
            template_buckets, subtype="missing_path_segment"
        ),
        "topTemplateBucketByVectorNoInstructionRemoved": pick_bucket_id_by_reason(
            template_buckets, reason="no_instruction_removed"
        ),
        "topStructureBucketByDeleteRemovedZeroCommands": pick_bucket_id_by_subtype(
            structure_buckets, subtype="delete_pass_removed_zero_commands"
        ),
        "exporterBucketCount": len(exporter_buckets),
        "templateBucketCount": len(template_buckets),
        "structureBucketCount": len(structure_buckets),
        "topExporterFailureBuckets": summary_payload.get("topExporterFailureBuckets", []),
        "topTemplateFailureBuckets": summary_payload.get("topTemplateFailureBuckets", []),
        "topStructureFailureBuckets": summary_payload.get("topStructureFailureBuckets", []),
    }


def pick_bucket_id(buckets: list[dict[str, Any]], metric_key: str) -> str:
    if not buckets:
        return "none"
    ordered = sorted(
        buckets,
        key=lambda row: int(row.get(metric_key, 0)),
        reverse=True,
    )
    return str(ordered[0].get("bucketId", "none"))


def pick_bucket_id_by_reason(buckets: list[dict[str, Any]], reason: str) -> str:
    if not buckets:
        return "none"
    ordered = sorted(
        buckets,
        key=lambda row: int(row.get("coreReasonBreakdown", {}).get(reason, 0)),
        reverse=True,
    )
    return str(ordered[0].get("bucketId", "none"))


def pick_bucket_id_by_subtype(buckets: list[dict[str, Any]], subtype: str) -> str:
    if not buckets:
        return "none"
    ordered = sorted(
        buckets,
        key=lambda row: int(row.get("subtypeBreakdown", {}).get(subtype, 0)),
        reverse=True,
    )
    return str(ordered[0].get("bucketId", "none"))


def build_quality_metrics(
    *,
    candidates: list[dict[str, Any]],
    applied_operations: list[dict[str, Any]],
    skipped_operations: list[dict[str, Any]],
    candidate_attempts: dict[str, int],
    candidate_hits: dict[str, int],
) -> dict[str, Any]:
    candidate_kind_by_id = {
        str(item.get("id", "")): str(item.get("kind", "")) for item in candidates if item.get("id")
    }

    anchor_count = sum(len(item.get("anchors", [])) for item in candidates)
    reliable_anchor_count = sum(
        1
        for item in candidates
        for anchor in item.get("anchors", [])
        if anchor.get("reliability") == "reliable"
    )
    attempted_operation_count = len(applied_operations) + len(skipped_operations)
    applied_operation_count = len(applied_operations)
    no_instruction_removed_count = sum(
        1 for item in skipped_operations if str(item.get("reason", "")).startswith("no_instruction_removed")
    )
    partial_hit_candidate_count = sum(
        1
        for candidate_id, attempts in candidate_attempts.items()
        if attempts > 0 and 0 < candidate_hits.get(candidate_id, 0) < attempts
    )
    removal_success_rate = (
        float(applied_operation_count) / float(attempted_operation_count)
        if attempted_operation_count > 0
        else 0.0
    )
    reliable_anchor_rate = (
        float(reliable_anchor_count) / float(anchor_count) if anchor_count > 0 else 0.0
    )

    vector_attempted = 0
    vector_applied = 0
    vector_no_instruction_removed = 0
    vector_span_shape_mismatch = 0
    vector_depth_mismatch = 0
    vector_missing_path_segment = 0
    vector_missing_paint_segment = 0
    vector_required_paint_missing = 0
    vector_signature_prefix_mismatch = 0
    vector_signature_operator_seq_mismatch = 0
    vector_signature_bbox_mismatch = 0
    vector_delete_removed_zero = 0
    vector_residual_path_left = 0
    vector_residual_paint_left = 0

    for item in applied_operations:
        candidate_id = str(item.get("candidateId", ""))
        if candidate_kind_by_id.get(candidate_id) == "vector":
            vector_applied += 1
            vector_attempted += 1
    for item in skipped_operations:
        candidate_id = str(item.get("candidateId", ""))
        reason = str(item.get("reason", ""))
        detail = item.get("detail", {}) if isinstance(item.get("detail"), dict) else {}
        subtype = str(detail.get("subtype", ""))
        if candidate_kind_by_id.get(candidate_id) == "vector":
            vector_attempted += 1
            if reason == "no_instruction_removed":
                vector_no_instruction_removed += 1
            if reason == "span_shape_mismatch":
                vector_span_shape_mismatch += 1
            if reason == "graphics_depth_mismatch":
                vector_depth_mismatch += 1
            if subtype == "missing_path_segment":
                vector_missing_path_segment += 1
            if subtype == "missing_paint_segment":
                vector_missing_paint_segment += 1
            if subtype == "missing_required_paint_operator":
                vector_required_paint_missing += 1
            if subtype == "signature_prefix_mismatch":
                vector_signature_prefix_mismatch += 1
            if subtype == "signature_operator_sequence_mismatch":
                vector_signature_operator_seq_mismatch += 1
            if subtype == "signature_bbox_mismatch":
                vector_signature_bbox_mismatch += 1
            if subtype == "delete_pass_removed_zero_commands":
                vector_delete_removed_zero += 1
            if subtype == "delete_pass_left_residual_path":
                vector_residual_path_left += 1
            if subtype == "delete_pass_left_residual_paint":
                vector_residual_paint_left += 1

    vector_success_rate = (
        float(vector_applied) / float(vector_attempted) if vector_attempted > 0 else 0.0
    )

    return {
        "candidateCount": len(candidates),
        "anchorCount": anchor_count,
        "reliableAnchorCount": reliable_anchor_count,
        "reliableAnchorRate": round(reliable_anchor_rate, 4),
        "attemptedOperationCount": attempted_operation_count,
        "appliedOperationCount": applied_operation_count,
        "noInstructionRemovedCount": no_instruction_removed_count,
        "partialHitCandidateCount": partial_hit_candidate_count,
        "removalSuccessRate": round(removal_success_rate, 4),
        "vectorAttemptedOperationCount": vector_attempted,
        "vectorAppliedOperationCount": vector_applied,
        "vectorNoInstructionRemovedCount": vector_no_instruction_removed,
        "vectorRemovalSuccessRate": round(vector_success_rate, 4),
        "vectorSpanShapeMismatchCount": vector_span_shape_mismatch,
        "vectorGraphicsDepthMismatchCount": vector_depth_mismatch,
        "vectorMissingPathSegmentCount": vector_missing_path_segment,
        "vectorMissingPaintSegmentCount": vector_missing_paint_segment,
        "vectorRequiredPaintOperatorMissingCount": vector_required_paint_missing,
        "vectorSignaturePrefixMismatchCount": vector_signature_prefix_mismatch,
        "vectorSignatureOperatorSequenceMismatchCount": vector_signature_operator_seq_mismatch,
        "vectorSignatureBBoxMismatchCount": vector_signature_bbox_mismatch,
        "vectorDeleteRemovedZeroCommandsCount": vector_delete_removed_zero,
        "vectorResidualPathLeftCount": vector_residual_path_left,
        "vectorResidualPaintLeftCount": vector_residual_paint_left,
    }


def should_execute_anchor(*, kind: str, reliability: str) -> bool:
    if reliability == "weak":
        return False
    if kind == "text":
        return reliability == "reliable"
    return reliability in {"reliable", "probable"}


def validate_anchor_against_commands(
    *,
    precheck_ctx: dict[str, Any],
    operator_type: str,
    operator_name: str,
    resource_name: str,
 ) -> tuple[bool, str, str, dict[str, Any]]:
    span = precheck_ctx.get("span", [])
    op_names = [operator_name_of(item) for item in span]
    observed = precheck_ctx.get("observed", {})
    expected = precheck_ctx.get("expected", {})
    diagnostics = precheck_ctx.get("diagnostics", {})

    if diagnostics.get("spanCoverageInvalid"):
        return False, "span_shape_mismatch", "missing_path_segment", observed
    if diagnostics.get("missingPathSegment"):
        return False, "span_shape_mismatch", "missing_path_segment", observed
    if diagnostics.get("missingPaintSegment"):
        return False, "span_shape_mismatch", "missing_paint_segment", observed
    if diagnostics.get("missingRequiredPaintOperator"):
        return False, "span_shape_mismatch", "missing_required_paint_operator", observed
    if diagnostics.get("graphicsDepthMismatch"):
        return False, "graphics_depth_mismatch", "depth_value_mismatch", observed

    if operator_name and operator_name not in op_names:
        return False, "operator_mismatch", "operator_name_missing_in_span", observed
    if operator_type == "xobject_do":
        if "Do" not in op_names:
            return False, "operator_mismatch", "xobject_operator_missing", observed
        if resource_name:
            matched = False
            for item in span:
                if operator_name_of(item) != "Do":
                    continue
                operands = instruction_operands(item)
                if operands and normalize_resource_name(operands[-1]) == normalize_resource_name(resource_name):
                    matched = True
                    break
            if not matched:
                return False, "resource_name_mismatch", "xobject_resource_missing", observed
    if operator_type == "text_show":
        if not any(name in TEXT_OPERATORS for name in op_names):
            return False, "operator_mismatch", "text_show_operator_missing", observed
    if operator_type == "vector_paint":
        if not any(name in VECTOR_PAINT_OPERATORS for name in op_names):
            return False, "operator_mismatch", "vector_paint_operator_missing", observed
        if diagnostics.get("pathOperatorSequenceMismatch"):
            return False, "span_shape_mismatch", "signature_operator_sequence_mismatch", observed
        if diagnostics.get("paintOperatorSequenceMismatch"):
            return False, "span_shape_mismatch", "signature_operator_sequence_mismatch", observed
        if diagnostics.get("signaturePrefixMismatch"):
            return False, "span_shape_mismatch", "signature_prefix_mismatch", observed
        if diagnostics.get("signatureBBoxMismatch"):
            return False, "span_shape_mismatch", "signature_bbox_mismatch", observed
    return True, "", "", observed


def operator_name_of(instruction: Any) -> str:
    return operator_name(instruction)


def build_graphics_depth_map(instructions: list[Any]) -> list[int]:
    depth = 0
    result: list[int] = []
    for instruction in instructions:
        op_name = operator_name_of(instruction)
        if op_name == "q":
            depth += 1
            result.append(depth)
            continue
        if op_name == "Q":
            result.append(depth)
            depth = max(0, depth - 1)
            continue
        result.append(depth)
    return result


def build_vector_precheck_context(
    *,
    instructions: list[Any],
    depth_map: list[int],
    start: int,
    end: int,
    path_start: int,
    path_end: int,
    paint_start: int,
    paint_end: int,
    expected_path_ops: list[str],
    expected_paint_ops: list[str],
    expected_signature: str,
    expected_depth: int,
    block_id: str,
) -> dict[str, Any]:
    span = instructions[start : end + 1] if 0 <= start <= end < len(instructions) else []
    relative_path_start = path_start - start
    relative_path_end = path_end - start
    relative_paint_start = paint_start - start
    relative_paint_end = paint_end - start
    path_slice = (
        span[relative_path_start : relative_path_end + 1]
        if 0 <= relative_path_start <= relative_path_end < len(span)
        else []
    )
    paint_slice = (
        span[relative_paint_start : relative_paint_end + 1]
        if 0 <= relative_paint_start <= relative_paint_end < len(span)
        else []
    )
    actual_path_ops = [operator_name_of(item) for item in path_slice if operator_name_of(item) in VECTOR_PATH_OPERATORS]
    actual_paint_ops = [operator_name_of(item) for item in paint_slice if operator_name_of(item) in VECTOR_PAINT_OPERATORS]
    span_depths = depth_map[start : end + 1] if span else []
    actual_depth = span_depths[0] if span_depths else -1
    actual_signature = build_vector_span_signature(
        path_ops=actual_path_ops,
        paint_ops=actual_paint_ops,
        graphics_depth=actual_depth,
        command_count=len(span),
    )
    signature_mode = classify_signature_match(expected_signature, actual_signature)
    path_operator_missing = expected_path_ops and not near_match_operator_sequence(expected_path_ops, actual_path_ops)
    paint_operator_missing = expected_paint_ops and not near_match_operator_sequence(expected_paint_ops, actual_paint_ops)

    diagnostics = {
        "spanCoverageInvalid": not (
            start <= path_start <= path_end <= paint_start <= paint_end <= end
        ),
        "missingPathSegment": len(actual_path_ops) <= 0,
        "missingPaintSegment": len(actual_paint_ops) <= 0,
        "missingRequiredPaintOperator": paint_operator_missing,
        "graphicsDepthMismatch": expected_depth >= 0 and any(depth != expected_depth for depth in span_depths),
        "pathOperatorSequenceMismatch": path_operator_missing,
        "paintOperatorSequenceMismatch": paint_operator_missing,
        "signaturePrefixMismatch": signature_mode == "mismatch_prefix",
        "signatureBBoxMismatch": signature_mode == "bbox_only_drift",
    }

    return {
        "stage": "precheck",
        "blockId": block_id,
        "expected": {
            "commandStart": start,
            "commandEnd": end,
            "pathStart": path_start,
            "pathEnd": path_end,
            "paintStart": paint_start,
            "paintEnd": paint_end,
            "graphicsDepth": expected_depth,
            "spanShapeSignature": expected_signature,
            "pathOperators": expected_path_ops,
            "paintOperators": expected_paint_ops,
        },
        "observed": {
            "commandStart": start,
            "commandEnd": end,
            "pathStart": path_start,
            "pathEnd": path_end,
            "paintStart": paint_start,
            "paintEnd": paint_end,
            "graphicsDepth": actual_depth,
            "spanShapeSignature": actual_signature,
            "pathOperators": actual_path_ops,
            "paintOperators": actual_paint_ops,
            "signatureMatchMode": signature_mode,
        },
        "missing": {
            "pathSegment": len(actual_path_ops) <= 0,
            "paintSegment": len(actual_paint_ops) <= 0,
            "requiredOperators": [op for op in expected_paint_ops if op not in actual_paint_ops],
        },
        "removedCommandCount": 0,
        "notes": [],
        "diagnostics": diagnostics,
        "span": span,
    }


def enrich_skip_detail(
    precheck_ctx: dict[str, Any],
    *,
    stage: str,
    subtype: str,
    observed: dict[str, Any] | None = None,
    notes: list[str] | None = None,
    removed_command_count: int = 0,
) -> dict[str, Any]:
    normalized_subtype = subtype
    if observed is not None and isinstance(observed, dict):
        normalized_subtype = str(observed.get("normalizedSubtype", subtype))
    output = {
        "stage": stage,
        "subtype": subtype,
        "normalizedSubtype": normalized_subtype,
        "blockId": precheck_ctx.get("blockId", ""),
        "expected": precheck_ctx.get("expected", {}),
        "observed": observed if observed is not None else precheck_ctx.get("observed", {}),
        "missing": precheck_ctx.get("missing", {}),
        "removedCommandCount": removed_command_count,
        "notes": notes or [],
    }
    return output


def pick_image_blocked_subtype(candidate_reasons: list[str]) -> str:
    if "full_page_slide_raster" in candidate_reasons:
        return "full_page_slide_raster"
    if "likely_page_background_image" in candidate_reasons:
        return "likely_page_background_image"
    return "unsafe_candidate_blocked"


def normalize_image_skip_subtype(subtype: str, reason: str) -> str:
    known = {
        "full_page_slide_raster",
        "likely_page_background_image",
        "unsafe_candidate_blocked",
        "operator_mismatch",
        "resource_name_mismatch",
        "delete_pass_removed_zero_commands",
    }
    if subtype in known:
        return subtype
    if reason in {"operator_mismatch", "resource_name_mismatch"}:
        return reason
    if reason == "full_page_candidate_blocked":
        return "full_page_slide_raster"
    if reason == "unsafe_candidate_blocked":
        return "unsafe_candidate_blocked"
    if subtype:
        return subtype
    return "delete_pass_removed_zero_commands" if reason == "no_instruction_removed" else "unknown"


def build_vector_debug_entry(
    *,
    candidate_id: str,
    anchor_id: str,
    page_num: int,
    block_id: str,
    precheck: dict[str, Any],
    delete_result: dict[str, Any],
    postcheck: dict[str, Any],
    final_status: str,
    core_reason: str,
    detail: dict[str, Any],
) -> dict[str, Any]:
    return {
        "candidateId": candidate_id,
        "anchorId": anchor_id,
        "blockId": block_id,
        "page": page_num,
        "precheck": sanitize_precheck_for_debug(precheck),
        "deleteResult": delete_result,
        "postcheck": postcheck,
        "finalStatus": final_status,
        "coreReason": core_reason,
        "detail": detail,
    }


def sanitize_precheck_for_debug(precheck: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in precheck.items()
        if key not in {"span"}
    }


def classify_signature_match(expected_signature: str, actual_signature: str) -> str:
    if not expected_signature:
        return "empty_expected"
    if expected_signature == actual_signature:
        return "exact"
    expected_parts = expected_signature.split("|")
    actual_parts = actual_signature.split("|")
    expected_prefix = [part for part in expected_parts if not part.startswith("bbox:")]
    actual_prefix = [part for part in actual_parts if not part.startswith("bbox:")]
    if expected_prefix == actual_prefix:
        return "bbox_only_drift"
    if all(part in actual_prefix for part in expected_prefix[:3]):
        return "approximate"
    return "mismatch_prefix"


def build_anchor_id(candidate_id: str, anchor: dict[str, Any]) -> str:
    block_id = str(anchor.get("blockId", ""))
    if block_id:
        return f"{candidate_id}:{block_id}"
    page = int(anchor.get("page", -1))
    start = int(anchor.get("commandStart", -1))
    end = int(anchor.get("commandEnd", -1))
    return f"{candidate_id}:p{page}:{start}-{end}"


def near_match_operator_sequence(expected: list[str], actual: list[str]) -> bool:
    if not expected:
        return True
    if expected == actual:
        return True
    if len(actual) < len(expected):
        return False
    for idx in range(0, len(actual) - len(expected) + 1):
        if actual[idx : idx + len(expected)] == expected:
            return True
    return False


def build_vector_span_signature(
    *, path_ops: list[str], paint_ops: list[str], graphics_depth: int, command_count: int
) -> str:
    return (
        f"path:{','.join(path_ops)}|paint:{','.join(paint_ops)}|depth:{graphics_depth}"
        f"|count:{command_count}"
    )


def near_match_signature(expected_signature: str, actual_signature: str) -> bool:
    expected_parts = expected_signature.split("|")
    actual_parts = actual_signature.split("|")
    expected_prefix = [part for part in expected_parts if not part.startswith("bbox:")]
    actual_prefix = [part for part in actual_parts if not part.startswith("bbox:")]
    if not expected_prefix:
        return True
    if expected_prefix == actual_prefix:
        return True
    return all(part in actual_prefix for part in expected_prefix[:3])


def build_metrics_comparison(previous_metrics: Any, current_metrics: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(previous_metrics, dict):
        return None
    try:
        delta = {}
        for key, current_value in current_metrics.items():
            previous_value = previous_metrics.get(key)
            if isinstance(current_value, (int, float)) and isinstance(previous_value, (int, float)):
                delta[key] = round(float(current_value) - float(previous_value), 4)
            else:
                delta[key] = None
        return {
            "previous": previous_metrics,
            "current": current_metrics,
            "delta": delta,
        }
    except Exception:  # pylint: disable=broad-except
        return None


def iso_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())

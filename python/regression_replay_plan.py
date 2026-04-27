#!/usr/bin/env python3
"""Build regression replay plans for single or multiple jobs."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from replay_sampler import (
    build_sampling_strategy,
    select_failure_samples,
    select_near_miss_samples,
    select_success_controls,
    split_replay_classes,
)


def build_regression_replay_plan(
    *,
    summary_payload: dict[str, Any],
    debug_payload: dict[str, Any],
    process_report: dict[str, Any],
    artifact_paths: dict[str, str],
    strategy_override: dict[str, Any] | None = None,
    filters: dict[str, str] | None = None,
    max_items: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    del process_report
    strategy = merge_sampling_strategy(strategy_override)
    debug_rows = [row for row in debug_payload.get("vectorDebug", []) if isinstance(row, dict)]
    filtered_rows = filter_debug_rows(debug_rows, filters or {})
    split_rows = split_replay_classes(filtered_rows)

    failure_rows = select_failure_samples(
        rows=split_rows["failure"],
        summary_payload=summary_payload,
        strategy=strategy,
    )
    success_rows = (
        select_success_controls(split_rows["success_control"], limit=8)
        if strategy.get("includeSuccessControls")
        else []
    )
    near_miss_rows = (
        select_near_miss_samples(split_rows["near_miss"], limit=10)
        if strategy.get("includeNearMissCases")
        else []
    )

    replay_items: list[dict[str, Any]] = []
    replay_items.extend(
        make_replay_items(
            rows=failure_rows,
            replay_class="failure",
            artifact_paths=artifact_paths,
            start_index=1,
        )
    )
    replay_items.extend(
        make_replay_items(
            rows=success_rows,
            replay_class="success_control",
            artifact_paths=artifact_paths,
            start_index=len(replay_items) + 1,
        )
    )
    replay_items.extend(
        make_replay_items(
            rows=near_miss_rows,
            replay_class="near_miss",
            artifact_paths=artifact_paths,
            start_index=len(replay_items) + 1,
        )
    )

    if max_items is not None and max_items > 0:
        replay_items = replay_items[:max_items]

    next_fix_targets = build_next_fix_targets(replay_items)
    plan_payload = {
        "jobId": str(summary_payload.get("jobId", debug_payload.get("jobId", ""))),
        "generatedAt": iso_now(),
        "sourceSummaryPath": artifact_paths.get("summaryPath", ""),
        "samplingStrategy": strategy,
        "filtersApplied": filters or {},
        "replayItems": replay_items,
        "summary": {
            "totalReplayItems": len(replay_items),
            "highPriorityCount": sum(1 for item in replay_items if item.get("priority") == "high"),
            "mediumPriorityCount": sum(1 for item in replay_items if item.get("priority") == "medium"),
            "successControlCount": sum(1 for item in replay_items if item.get("replayClass") == "success_control"),
            "nearMissCount": sum(1 for item in replay_items if item.get("replayClass") == "near_miss"),
        },
        "nextFixTargets": next_fix_targets,
    }
    suite_manifest = build_suite_manifest(replay_items)
    return plan_payload, suite_manifest


def make_replay_items(
    *,
    rows: list[dict[str, Any]],
    replay_class: str,
    artifact_paths: dict[str, str],
    start_index: int,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=start_index):
        priority_score = compute_priority_score(row=row, replay_class=replay_class)
        priority = classify_priority(priority_score)
        replay_id = f"replay-{idx:03d}"
        candidate_id = str(row.get("candidateId", ""))
        page = int(row.get("page", -1))

        item = {
            "replayId": replay_id,
            "priority": priority,
            "priorityScore": round(priority_score, 2),
            "replayClass": replay_class,
            "bucketType": choose_bucket_type(row),
            "bucketId": choose_bucket_id(row),
            "templatePageSignature": str(row.get("templatePageSignature", "unknown_template")),
            "structureTags": row.get("structureTags", []),
            "coreReason": str(row.get("coreReason", "")),
            "subtype": str(row.get("detail", {}).get("subtype", "")),
            "jobId": str(row.get("jobId", "")),
            "page": page,
            "candidateId": candidate_id,
            "blockId": str(row.get("blockId", "")),
            "selectionPayload": {
                "selections": [
                    {
                        "candidateId": candidate_id,
                        "applyMode": "current_page",
                        "explicitPages": [page] if page > 0 else [],
                    }
                ]
            },
            "expectedFailureMode": str(row.get("detail", {}).get("subtype", row.get("coreReason", ""))),
            "artifacts": {
                "pageCommandsPath": artifact_paths.get("pageCommandsPath", ""),
                "executionMapPath": artifact_paths.get("executionMapPath", ""),
                "processDebugPath": artifact_paths.get("processDebugPath", ""),
                "processReportPath": artifact_paths.get("processReportPath", ""),
            },
            "representativeSnippet": {
                "stage": row.get("detail", {}).get("stage", ""),
                "missing": row.get("detail", {}).get("missing", {}),
                "removedCommandCount": row.get("detail", {}).get("removedCommandCount", 0),
            },
            "tags": build_tags(row, replay_class=replay_class, priority=priority),
        }
        items.append(item)
    return items


def compute_priority_score(*, row: dict[str, Any], replay_class: str) -> float:
    score = 0.0
    subtype = str(row.get("detail", {}).get("subtype", ""))
    core_reason = str(row.get("coreReason", ""))
    template_sig = str(row.get("templatePageSignature", ""))
    structure_tags = row.get("structureTags", [])
    page_profile = row.get("pageLayoutProfile", {})
    footer_count = int(page_profile.get("footerVectorCount", 0))

    if replay_class == "failure":
        score += 70
    elif replay_class == "near_miss":
        score += 52
    else:
        score += 30

    if core_reason in {"span_shape_mismatch", "no_instruction_removed"}:
        score += 14
    if subtype in {
        "signature_operator_sequence_mismatch",
        "missing_path_segment",
        "delete_pass_removed_zero_commands",
    }:
        score += 12
    if subtype in {"delete_pass_left_residual_path", "delete_pass_left_residual_paint"}:
        score += 9
    if footer_count >= 2 or "footer:" in template_sig:
        score += 8
    if isinstance(structure_tags, list):
        if "deepGraphicsStack" in structure_tags:
            score += 6
        if "vectorHeavyPage" in structure_tags:
            score += 5
    if int(row.get("page", -1)) > 0:
        score += min(6, int(row.get("page", -1)) / 4)
    return score


def classify_priority(score: float) -> str:
    if score >= 82:
        return "high"
    if score >= 56:
        return "medium"
    return "low"


def choose_bucket_type(row: dict[str, Any]) -> str:
    if row.get("exporterBucketId"):
        return "exporter"
    if row.get("templatePageSignature"):
        return "template"
    return "structure"


def choose_bucket_id(row: dict[str, Any]) -> str:
    exporter = str(row.get("exporterBucketId", ""))
    if exporter:
        return exporter
    template = str(row.get("templatePageSignature", ""))
    if template:
        return template
    tags = row.get("structureTags", [])
    if isinstance(tags, list) and tags:
        return str(tags[0])
    return "unknown_bucket"


def build_tags(row: dict[str, Any], *, replay_class: str, priority: str) -> list[str]:
    tags = [
        "vector",
        f"replayClass:{replay_class}",
        f"priority:{priority}",
        f"exporter:{row.get('normalizedProducerFamily','unknown')}",
    ]
    for tag in row.get("structureTags", [])[:3]:
        tags.append(f"structure:{tag}")
    subtype = str(row.get("detail", {}).get("subtype", ""))
    if subtype:
        tags.append(f"subtype:{subtype}")
    return tags


def build_next_fix_targets(replay_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    subtype_map: dict[str, list[str]] = {}
    exporter_map: dict[str, list[str]] = {}
    template_map: dict[str, list[str]] = {}
    for item in replay_items:
        if item.get("replayClass") == "success_control":
            continue
        replay_id = str(item.get("replayId", ""))
        subtype = str(item.get("subtype", ""))
        exporter = str(item.get("bucketId", ""))
        template = str(item.get("templatePageSignature", ""))
        subtype_map.setdefault(subtype, []).append(replay_id)
        exporter_map.setdefault(exporter, []).append(replay_id)
        template_map.setdefault(template, []).append(replay_id)

    targets: list[dict[str, Any]] = []
    for subtype, replay_ids in top_n(subtype_map, 2):
        targets.append(
            {
                "targetType": "subtype",
                "targetId": subtype,
                "why": f"{len(replay_ids)} 个样本指向该失败子类型",
                "suggestedRuleArea": suggested_rule_area(subtype),
                "supportingReplayIds": replay_ids[:6],
            }
        )
    for exporter, replay_ids in top_n(exporter_map, 1):
        targets.append(
            {
                "targetType": "exporterBucket",
                "targetId": exporter,
                "why": f"该 exporter bucket 覆盖 {len(replay_ids)} 个失败/near-miss 样本",
                "suggestedRuleArea": "vector span signature tolerance",
                "supportingReplayIds": replay_ids[:6],
            }
        )
    for template, replay_ids in top_n(template_map, 1):
        targets.append(
            {
                "targetType": "templateBucket",
                "targetId": template,
                "why": f"该模板签名出现 {len(replay_ids)} 次失败",
                "suggestedRuleArea": "path backtracking boundary",
                "supportingReplayIds": replay_ids[:6],
            }
        )
    return targets[:6]


def build_suite_manifest(replay_items: list[dict[str, Any]]) -> dict[str, Any]:
    exporter = {
        str(item.get("bucketId", ""))
        for item in replay_items
        if str(item.get("bucketType", "")) == "exporter"
    }
    template = {
        str(item.get("templatePageSignature", ""))
        for item in replay_items
        if str(item.get("templatePageSignature", ""))
    }
    structure = {
        str(tag)
        for item in replay_items
        for tag in item.get("structureTags", [])
    }
    subtypes = {
        str(item.get("subtype", ""))
        for item in replay_items
        if str(item.get("subtype", ""))
    }
    return {
        "generatedAt": iso_now(),
        "suiteName": "vector-debug-regression-v1",
        "items": replay_items,
        "coverage": {
            "exporterBucketCount": len(exporter),
            "templateBucketCount": len(template),
            "structureBucketCount": len(structure),
            "subtypeCount": len(subtypes),
        },
    }


def top_n(mapping: dict[str, list[str]], n: int) -> list[tuple[str, list[str]]]:
    return sorted(mapping.items(), key=lambda item: len(item[1]), reverse=True)[:n]


def suggested_rule_area(subtype: str) -> str:
    if subtype in {"signature_operator_sequence_mismatch", "signature_prefix_mismatch"}:
        return "vector span signature tolerance"
    if subtype in {"missing_path_segment"}:
        return "path backtracking boundary"
    if subtype in {"missing_paint_segment", "missing_required_paint_operator"}:
        return "paint segment detection"
    if subtype in {"depth_value_mismatch"}:
        return "graphics depth matching"
    if subtype in {"delete_pass_removed_zero_commands"}:
        return "delete range application"
    return "vector diagnostics triage"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline regression replay plan CLI")
    parser.add_argument("--job-dir", type=Path, help="Single job directory")
    parser.add_argument("--jobs-root", type=Path, help="Jobs root directory for batch scan")
    parser.add_argument("--job-glob", default="*", help="Job directory glob under jobs-root")
    parser.add_argument("--output-dir", type=Path, help="Output directory")
    parser.add_argument("--max-items", type=int, default=0, help="Max replay items per plan (0 means unlimited)")
    parser.add_argument("--include-success-controls", action="store_true", help="Include success controls")
    parser.add_argument("--include-near-miss", action="store_true", help="Include near-miss samples")
    parser.add_argument("--per-exporter-subtype-limit", type=int, default=3)
    parser.add_argument("--per-template-bucket-limit", type=int, default=2)
    parser.add_argument("--per-structure-bucket-limit", type=int, default=2)
    parser.add_argument("--exporter-bucket", default="")
    parser.add_argument("--template-bucket", default="")
    parser.add_argument("--structure-bucket", default="")
    parser.add_argument("--subtype", default="")
    parser.add_argument("--core-reason", default="")
    parser.add_argument("--replay-class", default="")
    parser.add_argument("--priority", default="")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.job_dir and not args.jobs_root:
        parser.error("必须提供 --job-dir 或 --jobs-root")
    if args.job_dir and args.jobs_root:
        parser.error("--job-dir 与 --jobs-root 不能同时使用")

    strategy_override = {
        "perExporterSubtypeLimit": args.per_exporter_subtype_limit,
        "perTemplateBucketLimit": args.per_template_bucket_limit,
        "perStructureBucketLimit": args.per_structure_bucket_limit,
        "includeSuccessControls": args.include_success_controls,
        "includeNearMissCases": args.include_near_miss,
    }
    filters = {
        "exporterBucket": args.exporter_bucket,
        "templateBucket": args.template_bucket,
        "structureBucket": args.structure_bucket,
        "subtype": args.subtype,
        "coreReason": args.core_reason,
        "replayClass": args.replay_class,
        "priority": args.priority,
    }
    max_items = args.max_items if args.max_items > 0 else None

    if args.job_dir:
        return run_single_job_mode(
            job_dir=args.job_dir,
            output_dir=args.output_dir,
            strategy_override=strategy_override,
            filters=filters,
            max_items=max_items,
        )
    return run_batch_mode(
        jobs_root=args.jobs_root,
        job_glob=args.job_glob,
        output_dir=args.output_dir,
        strategy_override=strategy_override,
        filters=filters,
        max_items=max_items,
    )


def run_single_job_mode(
    *,
    job_dir: Path,
    output_dir: Path | None,
    strategy_override: dict[str, Any],
    filters: dict[str, str],
    max_items: int | None,
) -> int:
    if not job_dir.exists() or not job_dir.is_dir():
        print(f"[error] job 目录不存在: {job_dir}")
        return 2
    loaded = load_job_payload(job_dir)
    if not loaded["ok"]:
        print(f"[error] 单 job 模式失败: {loaded['reason']}")
        return 3

    artifacts = build_artifact_paths(job_dir)
    plan, suite = build_regression_replay_plan(
        summary_payload=loaded["summary"],
        debug_payload=loaded["debug"],
        process_report=loaded["report"],
        artifact_paths=artifacts,
        strategy_override=strategy_override,
        filters=filters,
        max_items=max_items,
    )
    plan_path, manifest_path = resolve_single_job_output_paths(job_dir, output_dir)
    write_json(plan_path, plan)
    write_json(manifest_path, suite)
    print(f"[ok] replay plan: {plan_path}")
    print(f"[ok] suite manifest: {manifest_path}")
    return 0


def run_batch_mode(
    *,
    jobs_root: Path,
    job_glob: str,
    output_dir: Path | None,
    strategy_override: dict[str, Any],
    filters: dict[str, str],
    max_items: int | None,
) -> int:
    if not jobs_root.exists() or not jobs_root.is_dir():
        print(f"[error] jobs root 不存在: {jobs_root}")
        return 2
    job_dirs = sorted([path for path in jobs_root.glob(job_glob) if path.is_dir()])
    if not job_dirs:
        print("[error] 没有匹配到任何 job 目录")
        return 3

    out_root = output_dir or jobs_root
    replay_plan_root = out_root / "replay-plan"
    summary_root = out_root / "regression-summary"
    index_root = out_root / "replay-index"
    replay_plan_root.mkdir(parents=True, exist_ok=True)
    summary_root.mkdir(parents=True, exist_ok=True)
    index_root.mkdir(parents=True, exist_ok=True)

    all_items: list[dict[str, Any]] = []
    plans_generated: list[str] = []
    skip_reasons: Counter[str] = Counter()
    jobs_scanned = 0
    jobs_included = 0

    for job_dir in job_dirs:
        jobs_scanned += 1
        loaded = load_job_payload(job_dir)
        if not loaded["ok"]:
            skip_reasons[str(loaded["reason"])] += 1
            continue
        artifacts = build_artifact_paths(job_dir)
        try:
            plan, _suite = build_regression_replay_plan(
                summary_payload=loaded["summary"],
                debug_payload=loaded["debug"],
                process_report=loaded["report"],
                artifact_paths=artifacts,
                strategy_override=strategy_override,
                filters=filters,
                max_items=max_items,
            )
        except Exception:
            skip_reasons["plan_build_failed"] += 1
            continue
        plan_path = replay_plan_root / job_dir.name / "regression-replay-plan.v1.json"
        plan_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(plan_path, plan)
        plans_generated.append(str(plan_path))
        jobs_included += 1
        for item in plan.get("replayItems", []):
            row = dict(item)
            row["sourcePlanPath"] = str(plan_path)
            row["sourceJobId"] = str(item.get("jobId", ""))
            all_items.append(row)

    filtered_items = filter_replay_items(all_items, filters)
    if max_items is not None and max_items > 0:
        filtered_items = filtered_items[:max_items]

    suite_manifest = build_suite_manifest(filtered_items)
    suite_summary = build_suite_summary(
        jobs_scanned=jobs_scanned,
        jobs_included=jobs_included,
        skip_reasons=skip_reasons,
        replay_items=filtered_items,
        plans_generated=plans_generated,
    )
    replay_index = build_replay_index(filtered_items)

    manifest_path = summary_root / "regression-suite-manifest.v1.json"
    summary_path = summary_root / "regression-suite-summary.v1.json"
    index_path = index_root / "replay-index.v1.json"
    write_json(manifest_path, suite_manifest)
    write_json(summary_path, suite_summary)
    write_json(index_path, replay_index)

    print(f"[ok] 扫描 jobs: {jobs_scanned}, 纳入: {jobs_included}, 跳过: {jobs_scanned - jobs_included}")
    print(f"[ok] suite manifest: {manifest_path}")
    print(f"[ok] suite summary: {summary_path}")
    print(f"[ok] replay index: {index_path}")
    return 0


def load_job_payload(job_dir: Path) -> dict[str, Any]:
    required = {
        "debug": job_dir / "process-debug.v1.json",
        "summary": job_dir / "process-debug-summary.v1.json",
        "report": job_dir / "process-report.json",
    }
    for key, path in required.items():
        if not path.exists():
            return {"ok": False, "reason": f"missing_{key}"}
    try:
        debug = json.loads(required["debug"].read_text(encoding="utf-8"))
        summary = json.loads(required["summary"].read_text(encoding="utf-8"))
        report = json.loads(required["report"].read_text(encoding="utf-8"))
    except Exception:
        return {"ok": False, "reason": "json_parse_failed"}
    return {"ok": True, "debug": debug, "summary": summary, "report": report}


def build_artifact_paths(job_dir: Path) -> dict[str, str]:
    return {
        "summaryPath": str(job_dir / "process-debug-summary.v1.json"),
        "pageCommandsPath": str(job_dir / "page-commands.v1.json"),
        "executionMapPath": str(job_dir / "execution-map.v1.json"),
        "processDebugPath": str(job_dir / "process-debug.v1.json"),
        "processReportPath": str(job_dir / "process-report.json"),
    }


def resolve_single_job_output_paths(job_dir: Path, output_dir: Path | None) -> tuple[Path, Path]:
    root = output_dir or job_dir
    if output_dir:
        plan_path = root / "replay-plan" / job_dir.name / "regression-replay-plan.v1.json"
        manifest_path = root / "regression-summary" / "regression-suite-manifest.v1.json"
    else:
        plan_path = root / "regression-replay-plan.v1.json"
        manifest_path = root / "regression-suite-manifest.v1.json"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    return plan_path, manifest_path


def merge_sampling_strategy(override: dict[str, Any] | None) -> dict[str, Any]:
    strategy = build_sampling_strategy()
    if not override:
        return strategy
    for key, value in override.items():
        if value in (None, "", 0, False):
            continue
        strategy[key] = value
    return strategy


def filter_debug_rows(rows: list[dict[str, Any]], filters: dict[str, str]) -> list[dict[str, Any]]:
    def match(row: dict[str, Any]) -> bool:
        if filters.get("exporterBucket") and str(row.get("exporterBucketId", "")) != filters["exporterBucket"]:
            return False
        if filters.get("templateBucket") and str(row.get("templatePageSignature", "")) != filters["templateBucket"]:
            return False
        if filters.get("structureBucket"):
            tags = row.get("structureTags", [])
            if not isinstance(tags, list) or filters["structureBucket"] not in [str(tag) for tag in tags]:
                return False
        if filters.get("subtype") and str(row.get("detail", {}).get("subtype", "")) != filters["subtype"]:
            return False
        if filters.get("coreReason") and str(row.get("coreReason", "")) != filters["coreReason"]:
            return False
        return True

    return [row for row in rows if match(row)]


def filter_replay_items(items: list[dict[str, Any]], filters: dict[str, str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for item in items:
        if filters.get("exporterBucket") and str(item.get("bucketId", "")) != filters["exporterBucket"]:
            continue
        if filters.get("templateBucket") and str(item.get("templatePageSignature", "")) != filters["templateBucket"]:
            continue
        if filters.get("structureBucket"):
            tags = item.get("structureTags", [])
            if not isinstance(tags, list) or filters["structureBucket"] not in [str(tag) for tag in tags]:
                continue
        if filters.get("subtype") and str(item.get("subtype", "")) != filters["subtype"]:
            continue
        if filters.get("coreReason") and str(item.get("coreReason", "")) != filters["coreReason"]:
            continue
        if filters.get("replayClass") and str(item.get("replayClass", "")) != filters["replayClass"]:
            continue
        if filters.get("priority") and str(item.get("priority", "")) != filters["priority"]:
            continue
        result.append(item)
    return result


def build_suite_summary(
    *,
    jobs_scanned: int,
    jobs_included: int,
    skip_reasons: Counter[str],
    replay_items: list[dict[str, Any]],
    plans_generated: list[str],
) -> dict[str, Any]:
    exporter = {str(item.get("bucketId", "")) for item in replay_items if item.get("bucketType") == "exporter"}
    template = {str(item.get("templatePageSignature", "")) for item in replay_items if item.get("templatePageSignature")}
    structure = {str(tag) for item in replay_items for tag in item.get("structureTags", [])}
    subtype_counter = Counter(str(item.get("subtype", "")) for item in replay_items if item.get("subtype"))
    top_exporter = Counter(
        str(item.get("bucketId", ""))
        for item in replay_items
        if item.get("bucketType") == "exporter" and item.get("replayClass") != "success_control"
    )
    top_template = Counter(
        str(item.get("templatePageSignature", ""))
        for item in replay_items
        if item.get("replayClass") != "success_control"
    )
    top_structure = Counter(
        str(tag)
        for item in replay_items
        if item.get("replayClass") != "success_control"
        for tag in item.get("structureTags", [])
    )
    next_targets = build_next_fix_targets(replay_items)
    return {
        "generatedAt": iso_now(),
        "jobsScanned": jobs_scanned,
        "jobsIncluded": jobs_included,
        "jobsSkipped": jobs_scanned - jobs_included,
        "skipReasons": {
            "missing_process_debug": skip_reasons.get("missing_debug", 0),
            "missing_process_summary": skip_reasons.get("missing_summary", 0),
            "missing_process_report": skip_reasons.get("missing_report", 0),
            "json_parse_failed": skip_reasons.get("json_parse_failed", 0),
            "plan_build_failed": skip_reasons.get("plan_build_failed", 0),
        },
        "coverage": {
            "exporterBucketCount": len(exporter),
            "templateBucketCount": len(template),
            "structureBucketCount": len(structure),
            "subtypeCount": len(subtype_counter.keys()),
        },
        "topExporterFailureBuckets": [bucket for bucket, _ in top_exporter.most_common(6)],
        "topTemplateFailureBuckets": [bucket for bucket, _ in top_template.most_common(6)],
        "topStructureFailureBuckets": [bucket for bucket, _ in top_structure.most_common(6)],
        "topSubtypes": [{"subtype": subtype, "count": count} for subtype, count in subtype_counter.most_common(8)],
        "nextFixTargets": next_targets,
        "plansGenerated": plans_generated,
    }


def build_replay_index(replay_items: list[dict[str, Any]]) -> dict[str, Any]:
    items = []
    for row in replay_items:
        items.append(
            {
                "replayId": row.get("replayId", ""),
                "sourceJobId": row.get("sourceJobId", row.get("jobId", "")),
                "priority": row.get("priority", ""),
                "priorityScore": row.get("priorityScore", 0),
                "replayClass": row.get("replayClass", ""),
                "bucketType": row.get("bucketType", ""),
                "bucketId": row.get("bucketId", ""),
                "templatePageSignature": row.get("templatePageSignature", ""),
                "structureTags": row.get("structureTags", []),
                "coreReason": row.get("coreReason", ""),
                "subtype": row.get("subtype", ""),
                "candidateId": row.get("candidateId", ""),
                "blockId": row.get("blockId", ""),
                "page": row.get("page", -1),
                "sourcePlanPath": row.get("sourcePlanPath", ""),
            }
        )
    return {"generatedAt": iso_now(), "items": items}


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

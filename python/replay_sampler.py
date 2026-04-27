#!/usr/bin/env python3
"""Sampling utilities for regression replay plan generation."""

from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any


def build_sampling_strategy() -> dict[str, Any]:
    return {
        "perExporterSubtypeLimit": 3,
        "perTemplateBucketLimit": 2,
        "perStructureBucketLimit": 2,
        "includeSuccessControls": True,
        "includeNearMissCases": True,
    }


def split_replay_classes(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    failure: list[dict[str, Any]] = []
    success: list[dict[str, Any]] = []
    near_miss: list[dict[str, Any]] = []
    for row in rows:
        final_status = str(row.get("finalStatus", ""))
        subtype = str(row.get("detail", {}).get("subtype", ""))
        core_reason = str(row.get("coreReason", ""))
        if final_status == "applied":
            success.append(row)
            continue
        if final_status == "partial" or subtype in {
            "delete_pass_left_residual_path",
            "delete_pass_left_residual_paint",
            "delete_pass_removed_zero_commands",
        } or core_reason == "no_instruction_removed":
            near_miss.append(row)
            continue
        failure.append(row)
    return {
        "failure": failure,
        "success_control": success,
        "near_miss": near_miss,
    }


def select_failure_samples(
    *,
    rows: list[dict[str, Any]],
    summary_payload: dict[str, Any],
    strategy: dict[str, Any],
) -> list[dict[str, Any]]:
    exporter_rank = rank_bucket_ids(summary_payload.get("exporterBuckets", []))
    template_rank = rank_bucket_ids(summary_payload.get("templateBuckets", []))
    structure_rank = rank_bucket_ids(summary_payload.get("structureBuckets", []))
    subtype_counter = Counter(str(row.get("detail", {}).get("subtype", "none")) for row in rows)
    page_density = Counter(int(row.get("page", -1)) for row in rows if int(row.get("page", -1)) > 0)

    grouped_exporter_subtype: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    grouped_template: dict[str, list[dict[str, Any]]] = defaultdict(list)
    grouped_structure: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        exporter_bucket = str(row.get("exporterBucketId", "unknown_exporter"))
        subtype = str(row.get("detail", {}).get("subtype", "none"))
        grouped_exporter_subtype[(exporter_bucket, subtype)].append(row)

        template_bucket = str(row.get("templatePageSignature", "unknown_template"))
        grouped_template[template_bucket].append(row)

        tags = row.get("structureTags", [])
        if isinstance(tags, list) and tags:
            for tag in tags:
                grouped_structure[str(tag)].append(row)
        else:
            grouped_structure["unknown_structure"].append(row)

    picked: list[dict[str, Any]] = []
    used = set()

    per_exporter_subtype_limit = int(strategy.get("perExporterSubtypeLimit", 3))
    per_template_limit = int(strategy.get("perTemplateBucketLimit", 2))
    per_structure_limit = int(strategy.get("perStructureBucketLimit", 2))

    exporter_groups = sorted(
        grouped_exporter_subtype.items(),
        key=lambda item: (len(item[1]), -exporter_rank.get(item[0][0], 9999)),
        reverse=True,
    )
    for (bucket_id, _subtype), items in exporter_groups:
        count = 0
        for row in sort_rows_by_score(
            items,
            exporter_rank=exporter_rank,
            template_rank=template_rank,
            structure_rank=structure_rank,
            subtype_counter=subtype_counter,
            page_density=page_density,
        ):
            if count >= per_exporter_subtype_limit:
                break
            dedupe_key = row_dedupe_key(row)
            if dedupe_key in used:
                continue
            if violates_job_dominance(picked, row, bucket_id=bucket_id):
                continue
            used.add(dedupe_key)
            picked.append(row)
            count += 1

    template_groups = sorted(grouped_template.items(), key=lambda item: len(item[1]), reverse=True)
    for bucket_id, items in template_groups:
        count = 0
        for row in sort_rows_by_score(
            items,
            exporter_rank=exporter_rank,
            template_rank=template_rank,
            structure_rank=structure_rank,
            subtype_counter=subtype_counter,
            page_density=page_density,
        ):
            if count >= per_template_limit:
                break
            dedupe_key = row_dedupe_key(row)
            if dedupe_key in used:
                continue
            used.add(dedupe_key)
            picked.append(row)
            count += 1

    structure_groups = sorted(grouped_structure.items(), key=lambda item: len(item[1]), reverse=True)
    for bucket_id, items in structure_groups:
        count = 0
        for row in sort_rows_by_score(
            items,
            exporter_rank=exporter_rank,
            template_rank=template_rank,
            structure_rank=structure_rank,
            subtype_counter=subtype_counter,
            page_density=page_density,
        ):
            if count >= per_structure_limit:
                break
            dedupe_key = row_dedupe_key(row)
            if dedupe_key in used:
                continue
            used.add(dedupe_key)
            picked.append(row)
            count += 1

    return picked


def select_success_controls(rows: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    if not rows:
        return []
    grouped = defaultdict(list)
    for row in rows:
        grouped[str(row.get("exporterBucketId", "unknown_exporter"))].append(row)
    result: list[dict[str, Any]] = []
    used = set()
    for _bucket_id, items in sorted(grouped.items(), key=lambda pair: len(pair[1]), reverse=True):
        for row in items:
            key = row_dedupe_key(row)
            if key in used:
                continue
            used.add(key)
            result.append(row)
            break
        if len(result) >= limit:
            break
    return result


def select_near_miss_samples(rows: list[dict[str, Any]], limit: int = 10) -> list[dict[str, Any]]:
    priority_subtypes = {
        "delete_pass_left_residual_path",
        "delete_pass_left_residual_paint",
        "delete_pass_removed_zero_commands",
    }
    ordered = sorted(
        rows,
        key=lambda row: (
            1 if str(row.get("detail", {}).get("subtype", "")) in priority_subtypes else 0,
            1 if str(row.get("coreReason", "")) == "no_instruction_removed" else 0,
        ),
        reverse=True,
    )
    picked: list[dict[str, Any]] = []
    used = set()
    for row in ordered:
        key = row_dedupe_key(row)
        if key in used:
            continue
        used.add(key)
        picked.append(row)
        if len(picked) >= limit:
            break
    return picked


def rank_bucket_ids(buckets: list[dict[str, Any]]) -> dict[str, int]:
    rank: dict[str, int] = {}
    for idx, bucket in enumerate(buckets, start=1):
        rank[str(bucket.get("bucketId", "unknown"))] = idx
    return rank


def sort_rows_by_score(
    rows: list[dict[str, Any]],
    *,
    exporter_rank: dict[str, int],
    template_rank: dict[str, int],
    structure_rank: dict[str, int],
    subtype_counter: Counter[str],
    page_density: Counter[int],
) -> list[dict[str, Any]]:
    def score(row: dict[str, Any]) -> float:
        exporter_bucket = str(row.get("exporterBucketId", "unknown_exporter"))
        template_bucket = str(row.get("templatePageSignature", "unknown_template"))
        structure_tags = row.get("structureTags", [])
        subtype = str(row.get("detail", {}).get("subtype", "none"))
        page = int(row.get("page", -1))

        exporter_score = max(0, 25 - exporter_rank.get(exporter_bucket, 25))
        template_score = max(0, 20 - template_rank.get(template_bucket, 20))
        structure_score = 0
        if isinstance(structure_tags, list) and structure_tags:
            structure_score = max(
                max(0, 15 - structure_rank.get(str(tag), 15)) for tag in structure_tags
            )
        subtype_score = min(20, subtype_counter.get(subtype, 0))
        density_score = min(10, page_density.get(page, 0))
        footer_bonus = 8 if "footer:" in template_bucket else 0
        return exporter_score + template_score + structure_score + subtype_score + density_score + footer_bonus

    return sorted(rows, key=score, reverse=True)


def row_dedupe_key(row: dict[str, Any]) -> str:
    return (
        f"{row.get('jobId','')}|{row.get('page','')}|{row.get('candidateId','')}|"
        f"{row.get('blockId','')}"
    )


def violates_job_dominance(
    picked: list[dict[str, Any]],
    row: dict[str, Any],
    *,
    bucket_id: str,
    max_per_job: int = 1,
) -> bool:
    job_id = str(row.get("jobId", ""))
    if not job_id:
        return False
    existing = sum(
        1
        for item in picked
        if str(item.get("jobId", "")) == job_id and str(item.get("exporterBucketId", "")) == bucket_id
    )
    return existing >= max_per_job

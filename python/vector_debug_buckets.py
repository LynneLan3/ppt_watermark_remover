#!/usr/bin/env python3
"""Aggregate vector debug diagnostics into exporter/template/structure buckets."""

from __future__ import annotations

from collections import Counter
from typing import Any


def summarize_vector_debug(
    *,
    job_id: str,
    processed_at: str,
    vector_debug: list[dict[str, Any]],
) -> dict[str, Any]:
    exporter_buckets = aggregate_by_bucket(vector_debug, "exporterBucketId", "exporter")
    template_buckets = aggregate_by_bucket(vector_debug, "templatePageSignature", "template")
    structure_rows = expand_structure_rows(vector_debug)
    structure_buckets = aggregate_by_bucket(structure_rows, "structureBucketId", "structure")

    top_failure_modes = build_top_failure_modes(vector_debug)
    recommendations = build_recommendations(
        exporter_buckets=exporter_buckets,
        template_buckets=template_buckets,
        structure_buckets=structure_buckets,
    )

    return {
        "jobId": job_id,
        "processedAt": processed_at,
        "exporterBuckets": exporter_buckets,
        "templateBuckets": template_buckets,
        "structureBuckets": structure_buckets,
        "topFailureModes": top_failure_modes,
        "recommendations": recommendations,
        "topExporterFailureBuckets": [bucket["bucketId"] for bucket in exporter_buckets[:3]],
        "topTemplateFailureBuckets": [bucket["bucketId"] for bucket in template_buckets[:3]],
        "topStructureFailureBuckets": [bucket["bucketId"] for bucket in structure_buckets[:3]],
    }


def aggregate_by_bucket(
    rows: list[dict[str, Any]],
    bucket_key: str,
    bucket_type: str,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        bucket_id = str(row.get(bucket_key, "unknown") or "unknown")
        grouped.setdefault(bucket_id, []).append(row)

    buckets: list[dict[str, Any]] = []
    for bucket_id, items in grouped.items():
        attempted = len(items)
        applied = sum(1 for item in items if item.get("finalStatus") == "applied")
        skipped = attempted - applied
        reason_counter = Counter(str(item.get("coreReason", "unknown")) for item in items)
        subtype_counter = Counter(str(item.get("detail", {}).get("subtype", "none")) for item in items)
        pages_counter = Counter(int(item.get("page", -1)) for item in items if int(item.get("page", -1)) > 0)
        candidate_counter = Counter(str(item.get("candidateId", "")) for item in items if item.get("candidateId"))
        representative = [build_representative_sample(item) for item in items[:3]]

        buckets.append(
            {
                "bucketType": bucket_type,
                "bucketId": bucket_id,
                "sampleCount": attempted,
                "candidateCount": len(candidate_counter.keys()),
                "attemptedOperationCount": attempted,
                "appliedOperationCount": applied,
                "skipCount": skipped,
                "successRate": round(applied / attempted, 4) if attempted > 0 else 0.0,
                "coreReasonBreakdown": dict(reason_counter.most_common()),
                "subtypeBreakdown": dict(subtype_counter.most_common()),
                "topAffectedPages": [page for page, _ in pages_counter.most_common(5)],
                "topAffectedCandidates": [candidate for candidate, _ in candidate_counter.most_common(5)],
                "representativeSamples": representative,
            }
        )

    buckets.sort(key=lambda item: (item["skipCount"], item["sampleCount"]), reverse=True)
    return buckets


def expand_structure_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    expanded: list[dict[str, Any]] = []
    for row in rows:
        tags = row.get("structureTags", [])
        if not isinstance(tags, list) or len(tags) <= 0:
            clone = dict(row)
            clone["structureBucketId"] = "unknown_structure"
            expanded.append(clone)
            continue
        for tag in tags:
            clone = dict(row)
            clone["structureBucketId"] = str(tag)
            expanded.append(clone)
    return expanded


def build_top_failure_modes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counters = Counter()
    for row in rows:
        if row.get("finalStatus") == "applied":
            continue
        reason = str(row.get("coreReason", "unknown"))
        subtype = str(row.get("detail", {}).get("subtype", "none"))
        counters[(reason, subtype)] += 1
    return [
        {"coreReason": reason, "subtype": subtype, "count": count}
        for (reason, subtype), count in counters.most_common(8)
    ]


def build_recommendations(
    *,
    exporter_buckets: list[dict[str, Any]],
    template_buckets: list[dict[str, Any]],
    structure_buckets: list[dict[str, Any]],
) -> list[str]:
    recs: list[str] = []
    if exporter_buckets:
        top = exporter_buckets[0]
        recs.append(
            f"exporterBucket={top['bucketId']} skip较高，优先检查signature序列匹配与operator顺序容差。"
        )
    if template_buckets:
        top = template_buckets[0]
        recs.append(
            f"templateBucket={top['bucketId']}失败集中，优先复核path回溯边界与footer/header区域block划分。"
        )
    if structure_buckets:
        top = structure_buckets[0]
        recs.append(
            f"structureBucket={top['bucketId']}问题突出，优先排查depth对齐与删除后残片检测策略。"
        )
    return recs


def build_representative_sample(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "jobId": str(row.get("jobId", "")),
        "page": int(row.get("page", -1)),
        "candidateId": str(row.get("candidateId", "")),
        "blockId": str(row.get("blockId", "")),
        "coreReason": str(row.get("coreReason", "")),
        "subtype": str(row.get("detail", {}).get("subtype", "")),
        "snippet": {
            "stage": row.get("detail", {}).get("stage", ""),
            "missing": row.get("detail", {}).get("missing", {}),
            "removedCommandCount": row.get("detail", {}).get("removedCommandCount", 0),
        },
    }

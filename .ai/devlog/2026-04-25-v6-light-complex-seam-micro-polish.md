# Devlog

> 日期：2026-04-25
> 任务：v6 light_complex_diagram seam micro polish（仅补 seam 缺口，不破坏 v5 安全面）

---

## 任务目标

在不改变 v5 安全结果的前提下，仅通过 seam micro polish 把 `light_complex_diagram avgSeam` 从 `0.050482` 继续压到 `<0.050`。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| python/process_raster_watermark_v1.py | modify | 调整 v6 seam micro polish 触发/采样/dry-run/rollback 逻辑（仅 light_complex 分支） |
| python/regression/raster-suite/results/external-notebooklm-v6-after/regression-suite-results.v1.json | modify | 产出本轮 v6 全量回归结果 |
| python/regression/raster-suite/results/v6-manual-review/ | create | 导出 v5/v6 重点页人工对照素材 |
| .ai/project-state.md | modify | 更新当前工作项、关键指标与最近修改 |

---

## 每个文件修改说明

### 文件 1: python/process_raster_watermark_v1.py

**修改前**:
```python
if bool(seam_ring_diagnostics.get("seamRingStructureDense")):
    d["seamMicroPolishRejectedReason"] = "structure_dense_skipped"
    return candidate_pixels, v5, d

micro_ring = build_inner_seam_ring_points(trailing_mask_points, seam_target_box, 1)
for ref_mode in ("median", "clipped_mean"):
    for alpha_ramp in (0.93, 0.88, 0.85):
        ...
```

**修改后**:
```python
SEAM_MICRO_TARGET_SEAM = 0.05
SEAM_MICRO_DENSE_SIGNIFICANT_DROP = 0.012

if seam_after_ring <= SEAM_MICRO_TARGET_SEAM:
    d["seamMicroPolishRejectedReason"] = "seam_near_target"
    return candidate_pixels, v5, d

micro_ring = build_seam_micro_ring_points_from_v5_ring(
    mask_points, seam_target_box, seam_ring_points, seam_ring_width
)
for ref_mode in ("median", "clipped_mean"):
    for alpha_ramp in (1.05, 1.08, 1.1, 0.95, 0.9):
        ...
reason = dry_run_v6_accepts(ver_after, v5, pass_b, structure_dense)
```

**原因**:
- 将 micro ring 明确绑定在 v5 seam ring 基础上，避免扩范围；
- alpha 只做 5%-10% 微调；
- failed 页增加“零反弹”保护，dense 页要求“显著 seam 收益”才可放行。

### 文件 2: python/regression/raster-suite/results/external-notebooklm-v6-after/regression-suite-results.v1.json

**修改前**:
```json
（上一轮 v6 结果）
```

**修改后**:
```json
{
  "summary": {
    "lightComplexDiagramSummary": {
      "avgSeam": 0.050482,
      "seamMicroPolishAttemptedCount": 13,
      "seamMicroPolishAcceptedCount": 0,
      "seamMicroPolishRollbackCount": 13
    }
  }
}
```

**原因**:
记录本轮回归事实：尝试了更多 micro polish，但全部触发回滚，核心指标维持 v5 安全面。

### 文件 3: python/regression/raster-suite/results/v6-manual-review/

**修改前**:
```text
无该目录
```

**修改后**:
```text
v6-manual-review/
  notebooklm-main-seam-high-8/
  ai-super-individual-blueprint-focus/
  ...
  manifest.json
```

**原因**:
按重点页导出 v5/v6 result + seam ring overlay + seam micro overlay，支持人工检查右下角白块/硬边。

---

## 测试命令

```bash
python3 python/raster_regression_suite.py \
  --manifest python/regression/raster-suite/manifest.external-notebooklm.v1.json \
  --output-dir python/regression/raster-suite/results/external-notebooklm-v6-after \
  --baseline-results python/regression/raster-suite/results/external-notebooklm-v5-after/regression-suite-results.v1.json

pnpm lint
pnpm build
```

---

## 测试结果

### 关键指标对比

| 指标 | 修改前(v5) | 修改后(v6) | 变化 |
|------|-----------|-----------|------|
| 页级通过率 | 51.8% (59/114) | 51.8% (59/114) | 0 |
| light_complex_diagram 通过率 | 48.6% (35/72) | 48.6% (35/72) | 0 |
| light_complex_diagram avgSeam | 0.050482 | 0.050482 | 0 |
| light_complex_diagram avgBrightnessDelta | 0.038218 | 0.038218 | 0 |
| light_complex_diagram avgResidual | 0.260465 | 0.260465 | 0 |
| light_complex_diagram avgTexture | 0.589718 | 0.589718 | 0 |
| v5 passed became failed | 0 | 0 | 0 |

### 详细结果

- dark baseline：完全持平；
- seamMicroPolish：attempted=13, accepted=0, rollback=13；
- 重点页 v5/v6 result 图像哈希一致（无可见回退风险新增）。

---

## 未解决问题

1. `light_complex_diagram avgSeam` 仍未进入 `<0.050`（维持在 `0.050482`）。
2. residual high 页面仍是主要失败来源，seam micro polish 无法实质改善该类失败。

---

## 下一步建议

1. 进入 residual high 失败页专项（候选生成/掩码定位），停止继续挤压 seam micro polish。
2. light_plain 扩样可作为并行低风险项，但优先级低于 residual high 专项。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 对 structureDense 页面，微调类 seam 修边必须“显著收益 + 零反弹”才可放行 | v6 seam micro polish 全量回归 | 1 | 暂不升级 |


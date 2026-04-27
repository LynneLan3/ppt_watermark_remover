# Devlog

> 日期：2026-04-24
> 任务：v4 light_complex_diagram seam / brightness 副作用收敛

---

## 任务目标

在 v3 基础上围绕 light_complex_diagram 的 trailing cleanup、mask blending、seam brightness guard 做小步优化，并通过 9 个 NotebookLM PDF 回归验证。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| python/process_raster_watermark_v1.py | modify | 新增 trailing cleanup 诊断字段、结构密度检测、guard 触发记录、seam/brightness-aware rerank |
| python/raster_regression_suite.py | modify | regression summary 增加 trailing seam/brightness before/after 与 guard count |
| lib/jobs/types.ts | modify | 补充 process-report per-page 新诊断字段类型 |
| python/regression/raster-suite/results/external-notebooklm-v4-after/regression-suite-results.v1.json | modify | 生成 v4 回归结果 |
| .ai/project-state.md | modify | 更新当前工作项、关键指标、最近修改 |

---

## 每个文件修改说明

### 文件 1: python/process_raster_watermark_v1.py

**修改前**:
```python
selected = min(preferred, key=lambda row: row["score"]) if preferred else min(filtered_candidates, key=lambda row: row["score"])
```

**修改后**:
```python
near_residual_candidates = [
    row
    for row in filtered_candidates
    if row["method"] is not None
    and row["verification"]["residualWatermarkScore"]
    <= selected["verification"]["residualWatermarkScore"] + LIGHT_COMPLEX_RERANK_RESIDUAL_EPSILON
]
```

**原因**: residual 接近时优先选 seam/brightness 更低的 light_complex_diagram candidate，并记录 guard 触发原因。

### 文件 2: python/raster_regression_suite.py

**修改前**:
```python
"avgBrightnessDelta": mean_metric(rows, "brightnessDelta", fallback_key="damageLumaDelta"),
```

**修改后**:
```python
"avgTrailingSeamBefore": mean_metric(rows, "trailingSeamBefore", nonzero_only=True),
"avgTrailingSeamAfter": mean_metric(rows, "trailingSeamAfter", nonzero_only=True),
"seamGuardTriggeredCount": count_true(rows, "seamGuardTriggered"),
```

**原因**: 让 regression-suite-results.v1.json 可直接观察 trailing cleanup 是否降低 seam/brightness 副作用。

### 文件 3: lib/jobs/types.ts

**修改前**:
```ts
trailingCleanupApplied?: boolean;
```

**修改后**:
```ts
trailingFeatherRadius?: number;
trailingBrightnessMatched?: boolean;
trailingSeamBefore?: number;
trailingSeamAfter?: number;
selectedCandidateReason?: string;
```

**原因**: TypeScript report 类型与 Python process-report 新字段保持一致。

---

## 测试命令

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile python/process_raster_watermark_v1.py python/raster_regression_suite.py
PYTHONDONTWRITEBYTECODE=1 python3 python/raster_regression_suite.py --manifest python/regression/raster-suite/manifest.external-notebooklm.v1.json --output-dir python/regression/raster-suite/results/external-notebooklm-v4-after --baseline-results python/regression/raster-suite/results/external-notebooklm-v3-after/regression-suite-results.v1.json
pnpm lint
pnpm build
```

---

## 测试结果

### 关键指标对比

| 指标 | v3-after | v4-after | 变化 |
|------|----------|----------|------|
| full passed | 59/114 | 59/114 | 0 |
| dark baseline passed | 24/37 | 24/37 | 0 |
| light_complex_diagram passed | 35/72 | 35/72 | 0 |
| light_complex_diagram avgResidual | 0.271146 | 0.260106 | -0.011040 |
| light_complex_diagram avgDamageTextureDelta | 0.664337 | 0.590043 | -0.074294 |
| light_complex_diagram avgSeam | 0.049860 | 0.054928 | +0.005068 |
| light_complex_diagram avgBrightnessDelta | 0.040017 | 0.040757 | +0.000740 |

### 详细结果

- 回归 suite 完成，结果写入 `python/regression/raster-suite/results/external-notebooklm-v4-after/regression-suite-results.v1.json`。
- dark baseline 与 v3 完全持平。
- light_complex_diagram removal 和 texture 有改善，但 seam/brightness 未达到本轮目标。

---

## 未解决问题

1. trailing seam after 高于 before，说明补刀边缘仍会带来局部硬切。
2. notebooklm-main、ai-super-individual-blueprint 的失败页主要仍是 residual 高，局部修边无法解决。

---

## 下一步建议

1. 继续 v5 收敛，先做 pass-preserving seam-only edge ring blend，不建议立刻转 light_plain 扩样。
2. v5 的任何 trailing 后处理都必须以 candidate pass 状态不下降为硬门槛。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 对通过率敏感的图像清理后处理，应先设 pass-preserving guard，再追求局部视觉指标 | v4 light_complex_diagram 回归 | 1 | 暂不升级 |

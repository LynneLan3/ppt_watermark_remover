# Gamma / NotebookLM 样本验证流程

本流程用于评估真实导出文件的对象级清理支持质量，重点覆盖：

- Gamma 导出 PDF
- NotebookLM 导出 PDF

## 1) 样本放置方式

支持两种目录策略（都可）：

- 仓库外目录（推荐）：例如 `/Users/<you>/pdf-samples/gamma-notebooklm/`
- 仓库内安全目录：`temp/sample-corpus/`（已被 `.gitignore` 忽略）

建议并默认按以下结构组织（脚本按 source-type 子目录读取）：

- `<corpus-root>/gamma/*.pdf`
- `<corpus-root>/notebooklm/*.pdf`
- `<corpus-root>/other/*.pdf`

> 建议至少提供 `gamma/` 与 `notebooklm/` 两类目录，`other/` 可选。

## 2) 运行验证

先安装 Python 依赖：

```bash
python3 -m pip install -r engine/python/requirements.txt
```

执行样本验证：

```bash
PYTHONPATH=engine/python python3 engine/python/validation/corpus_validation.py \
  --samples-root "/path/to/your/sample-corpus" \
  --output-prefix "temp/validation/gamma-notebooklm-summary" \
  --source-types "gamma,notebooklm,other" \
  --mode "analyze-apply" \
  --work-dir "temp/validation/runs"
```

常用可选参数：

- `--max-files 30`：仅跑前 N 个样本（快速基线）
- `--source-types "gamma,notebooklm"`：只跑目标来源
- `--mode "analyze-only"`：只分析不执行 apply（先看分布）
- `--output`：兼容旧参数，直接指定 JSON 路径

执行后会生成三种摘要文件（同一前缀）：

- `*.json`：结构化明细 + 聚合统计
- `*.csv`：便于筛选/透视的逐文件表格
- `*.md`：便于团队分享和快速阅读的报告

## 3) 输出内容

`summary.*` 的逐文件行都会包含：

- `sourceType`
- `filename`
- `pages`
- `candidateCount`
- `supportedCandidateCount`
- `unsupportedCandidateCount`
- `targetLogoFooterHeaderFound`
- `cleanedOutputProduced`
- `usable`

并附加：

- `unsupportedReasonCodes`
- `selectedCandidateId`
- `selectedCandidateType`
- `selectedCandidateReasonCode`
- `failureReason`

`summary.json` 还包含聚合指标：

- `totalFiles`
- `usableFiles`
- `unsupportedFiles`
- `cleanedOutputFiles`
- `usableRateBySourceType`
- `topUnsupportedReasonCodes`
- `topSupportedReasonCodes`
- `supportedCandidateRateBySourceType`
- `unsupportedReasonDistributionBySourceType`
- `supportedReasonDistributionBySourceType`
- `priorityUnsupportedReasons`
- `prioritySupportedPatternsToExpand`
- `recommendedNextFocus`

每个样本的中间产物会输出到 `--work-dir/<sample-name>/`：

- `analysis.json`
- `plan.json`（若存在可执行候选）
- `cleaned.pdf`（若 apply 成功）
- `report.json`

## 4) 支持质量判定

当前内部判定：

- `supported`：候选可进入对象级 apply-plan，且满足安全阈值
- `review_required`：有重复信号但不够稳定，默认不自动执行
- `unsupported`：触发 fail-safe，不执行破坏性“伪清理”

`usable=true` 需要同时满足：

- 成功生成 `cleaned.pdf`
- apply 报告 `success=true`
- `matchedObjectsCount > 0`
- `removedObjectsCount > 0`

当 `--mode analyze-only` 时：

- 不会执行 apply，`cleanedOutputProduced=false`
- 文件用于“分布分析”，不用于最终可用率结论

## 5) 常见 unsupported reasonCode

- `large_background_image`
- `likely_background_baked`
- `non_repeated_decorative_image`
- `unsupported_structure`

这些 reasonCode 会通过分析结果返回给后端，可用于后续 UI 解释和统计。

## 6) 首次真实 Gamma / NotebookLM 基线跑法

1. 准备目录：
   - `.../gamma/` 放 Gamma 导出 PDF
   - `.../notebooklm/` 放 NotebookLM 导出 PDF
2. 先跑快速分布（可选）：
   - `--mode analyze-only --max-files 20`
3. 再跑完整可用率：
   - `--mode analyze-apply`
4. 重点读 `summary.md` 的三块：
   - `Usable Rate By Source Type`
   - `Top Unsupported Reason Codes`
   - `Prioritization`
5. 下一轮优化优先级建议：
   - 先看 `weakestSourceType`
   - 再看 `priorityUnsupportedReasons`
   - 只做与这些 reason code 对应的最小增量改进

## 7) 基线前后对比（Round 5E）

可将两次运行结果生成 delta 报告：

```bash
PYTHONPATH=engine/python python3 engine/python/validation/compare_validation_runs.py \
  --before "temp/validation/gamma-notebooklm-before-5d.json" \
  --after "temp/validation/gamma-notebooklm-after-5d.json" \
  --output-prefix "temp/validation/gamma-notebooklm-delta-5e"
```

会生成：

- `gamma-notebooklm-delta-5e.json`
- `gamma-notebooklm-delta-5e.md`

关键字段：

- `usableRateBySourceType` delta
- `usableFilesBySourceType` delta
- `unsupportedReasonDistributionBySourceType` delta
- `topSupportedReasonCodes` delta
- 文件级 `improvedUnusableToUsable` / `regressedUsableToUnusable`
- `recommendationQuality` delta

## 8) Gamma 平台期诊断（Round 5F）

在可用率进入平台期（Gamma 维持 `0.6667`）后，不再做大范围启发式扩展，改为只分析失败 Gamma 文件：

```bash
PYTHONPATH=engine/python python3 engine/python/validation/gamma_plateau_diagnosis.py \
  --summary-json "temp/validation/gamma-notebooklm-after-5d.json" \
  --work-dir "temp/validation/work-after-5d" \
  --output-prefix "temp/validation/gamma-plateau-diagnosis"
```

输出：

- `gamma-plateau-diagnosis.json`
- `gamma-plateau-diagnosis.md`

Round 5F 当前结论（基于真实语料）：

- 当前失败 Gamma 文件共 2 个：`CADA.pdf`、`r4pdv3d2bz862ld.pdf`
- `CADA.pdf`：无跨页可复用对象（`repeatCount>=2` 为 0），属于当前对象级策略下不可恢复
- `r4pdv3d2bz862ld.pdf`：仅有大背景图重复，角标类对象都是单页独立，需更广策略（背景分割/重建）才可能处理
- 小范围规则修补可恢复数：0
- 建议：暂停 Gamma 引擎扩展，转入 Beta（但必须明确支持边界）

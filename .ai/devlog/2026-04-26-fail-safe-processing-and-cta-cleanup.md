# Devlog

> 日期：2026-04-26
> 任务：失败态半成品隔离 + 首页 CTA 精简（不做算法优化）

---

## 任务目标

修复“处理中途失败后仍暴露半成品 processed.pdf”问题，并移除首页 `Replace file` 按钮，确保下载仅在 `ready_for_download` 且页数完整时启用。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| components/tool/upload-hero.tsx | modify | 移除 Replace file；主 CTA 仅保留 Remove watermark；失败态不渲染 cleaned 成功预览、不允许下载 |
| lib/jobs/service.ts | modify | 增加 process 命令/日志/状态/页数校验落盘；按 `failed/partial_failed` 分流；仅完整通过后进入 ready_for_download |
| python/process_raster_watermark_v1.py | modify | 每页 try/except；单页失败 fallback 原页；输出改为 `processed.tmp.pdf` 原子替换；页数不一致返回非零 |
| lib/storage/job-paths.ts | modify | 新增 `logs.txt`、`status.json`、`process-command.txt`、`page-count-check.json` 路径 |
| lib/jobs/types.ts | modify | 新增 `partial_failed` 状态与 `python_process_failed/page_count_mismatch/processed_file_missing/process_report_incomplete` 错误码 |
| lib/jobs/repository.ts | modify | 状态机支持 `processing -> partial_failed` |
| lib/jobs/api.ts | modify | 新错误码映射到明确用户文案，避免展示“process v2 python failed” |
| .ai/project-state.md | modify | 更新本轮工作项、关键指标、最近修改 |
| .ai/sop-candidates.md | modify | 追加本轮 SOP 候选 |
| .ai/devlog/2026-04-26-fail-safe-processing-and-cta-cleanup.md | create | 记录本轮修复细节、测试与建议 |

---

## 每个文件修改说明

### 文件 1: `components/tool/upload-hero.tsx`

**修改前**:
```tsx
// 有 Replace file 按钮
// ready_for_preview 阶段可能渲染 cleaned 侧
// 页数不一致时仍可能看到前几页 cleaned 预览
```

**修改后**:
```tsx
// 移除 Replace file，仅保留主 CTA
// showPreview 仅在 ready_for_download
// 若 processedPageCount !== sourcePageCount，显示失败错误卡并禁用下载
// poll terminal status 扩展到 partial_failed
```

**原因**:
防止用户把半成品当成可用结果；保持主流程单 CTA。

### 文件 2: `lib/jobs/service.ts`

**修改前**:
```ts
// python ok 后直接依赖 report 基础字段推进 ready_for_download
// 没有 original/processed/report 三方页数完整性硬校验
// 无 process-command/logs/status/page-count-check 落盘
```

**修改后**:
```ts
// 写 process-command.txt
// 写 logs.txt（exitCode/stdout/stderr/duration）
// 计算 originalPageCount / processedPageCount / processReportPageCount
// 不满足条件则抛 ProcessJobFailure 并转 failed 或 partial_failed
// 仅全部校验通过才 persistProcessOutput -> ready_for_download
```

**原因**:
阻断“半成品输出被标记成功”的链路。

### 文件 3: `python/process_raster_watermark_v1.py`

**修改前**:
```py
if result.get("success"):
    new_page = out_doc.new_page(...)
    new_page.insert_image(...)
# 失败页不写入 output，导致输出页数变少
out_doc.save(output_pdf)
```

**修改后**:
```py
# 每页 try/except
# 页失败 -> fallback_to_original=True，写回原页并继续
# 所有页都写入 out_doc
# 先保存 processed.tmp.pdf，再在页数匹配时 replace 为 processed.pdf
# 页数不匹配则产出 processed.partial.pdf 并返回非 0
```

**原因**:
保证单页失败不截断整份 PDF，且避免半成品文件冒充正式结果。

---

## 测试命令

```bash
pnpm lint
pnpm build
python3 -m py_compile python/process_raster_watermark_v1.py
python3 python/process_raster_watermark_v1.py \
  --request temp/jobs-v2/_agent_validation/process-request.v2.json \
  --input temp/jobs-v2/c1e163c4-fe54-48a8-b369-f2995f2ceaae/source.pdf \
  --output temp/jobs-v2/_agent_validation/processed.pdf \
  --report temp/jobs-v2/_agent_validation/process-report.json
```

---

## 测试结果

- `pnpm lint`: **pass**
- `pnpm build`: **pass**（存在 Turbopack tracing warnings，不阻塞）
- `python3 -m py_compile`: **pass**
- 12 页样本处理（`c1e163c4-fe54-48a8-b369-f2995f2ceaae/source.pdf`）：
  - 输入页数：12
  - 输出 `processed.pdf` 页数：12
  - `perPageResults` 页数：12
  - 失败页数：7
  - `fallbackToOriginal=true` 页数：7
- 文件级失败模拟（缺失输入文件）：
  - exit code：2
  - `processed.pdf`：不存在
  - `processed.tmp.pdf`：不存在
  - `processed.partial.pdf`：不存在
  - report 状态：`fatal_error`

---

## 未解决问题

1. 当前仍有 Turbopack tracing warnings（动态路径扫描范围偏大）。

---

## 下一步建议

1. 用目标 12 页 PDF 做端到端复现，重点记录 `page-count-check.json` 与前端状态。
2. 若后续要进一步提升稳定性，可将页数完整性校验提炼为可复用服务层守卫。
3. 评估将 `api/jobs/*` 与 `temp-jobs` 工作流统一，减少双套状态机维护成本。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 只要 processed 页数与 original 不一致，必须直接失败并禁止下载，不能展示半成品预览 | 本轮 fail-safe 修复 | 1 | 暂不升级 |
| Python 输出文件必须采用 `tmp -> atomic rename`，避免前端读到处理中间态文件 | 本轮 atomic write 修复 | 1 | 暂不升级 |

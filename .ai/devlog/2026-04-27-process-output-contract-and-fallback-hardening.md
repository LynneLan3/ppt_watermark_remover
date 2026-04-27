# 2026-04-27 Process 输出契约统一与 Fallback 加固

## 任务目标

修复 Preview 阶段 `process` 返回 `processed output missing` 的问题，统一输出字段契约，并确保 Python 不可用时通过 passthrough-fallback 可靠生成 `jobs/{jobId}/processed.pdf`。

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| app/api/jobs/[jobId]/process/route.ts | modify | process body source 优先、统一成功响应字段、失败结构化诊断 |
| lib/jobs/service.ts | modify | processJobStateless 输出字段统一；Blob 写入+回读校验；fallback 从 source buffer 直接写 processed.pdf |
| app/api/jobs/[jobId]/preview/route.ts | modify | 读取优先级统一：query/job/default/旧字段兼容 |
| app/api/jobs/[jobId]/download/route.ts | modify | 读取优先级统一：query/job/default/旧字段兼容 |
| app/api/jobs/[jobId]/debug/route.ts | modify | 输出 processedPathname/processedPdfExists/processedSize/processMode |
| components/tool/upload-hero.tsx | modify | process 调用透传 sourcePathname/sourceBlobUrl/analysis/analysisPath，并保存 process 结果字段 |
| lib/jobs/types.ts | modify | 增加 process_source_missing / processed_pdf_* / pdf_processor_* 错误码与 JobRecord processed 字段 |
| app/api/jobs/[jobId]/analyze/route.ts | modify | success data 增加 analysis，供 process body 透传 |
| .ai/project-state.md | modify | 更新项目状态 |

## 每个文件修改说明

### 1) process route

修改前：
- 主要返回 `data.processOutputPath/processOutputBlobUrl`，字段不统一。
- body 无 source 时逻辑不够明确。
- 失败诊断粒度不足。

修改后：
- 成功响应统一为：
```json
{
  "success": true,
  "jobId": "...",
  "status": "ready_for_download",
  "processedPathname": "jobs/{jobId}/processed.pdf",
  "processedBlobUrl": "...",
  "processedSize": 123,
  "processedContentType": "application/pdf",
  "processMode": "passthrough-fallback|python|raster_page"
}
```
- body source 优先，manifest fallback。
- source 缺失返回 `process_source_missing`（409）并附诊断字段。
- 失败返回 phase/code + 安全 error 结构。

### 2) process service

修改前：
- Python 失败后 fallback 依赖本地 output path，仍可能触发 `processed output missing`。

修改后：
- fallback 改为可靠路径：
  1. 直接拿 source buffer
  2. `put(jobs/{jobId}/processed.pdf, sourceBuffer)`
  3. `head(...)` 回读校验
- 写失败报 `processed_pdf_write_failed`
- 回读失败报 `processed_pdf_verify_failed`
- 非 preview 下 Python 失败区分：`pdf_processor_dependency_missing` / `pdf_processor_failed`
- manifest patch 改 best-effort：失败仅 warn，不阻塞 200。

### 3) preview/download

读取顺序统一：
1. query `processedPathname`
2. `job.processedPathname`
3. `jobs/{jobId}/processed.pdf`
4. 兼容旧字段（cleaned/output/processed 旧命名）

找不到时返回：`processed_pdf_not_found`。

### 4) debug endpoint

新增输出：
- `processedPathname`
- `processedBlobUrlHost`
- `processedPdfExists`
- `processedSize`
- `processMode`
- `status/errorCode/errorMessage`

## 测试命令

```bash
pnpm lint
pnpm build
```

## 测试结果

| 测试项 | 结果 |
|--------|------|
| pnpm lint | ✅ pass |
| pnpm build | ✅ pass |

## 未解决问题

1. 需要在 Preview 实际上传 0.43MB PDF 验证网络层 `process 200` 和 `preview/download` 可用。

## 下一步建议

1. Preview 复测 0.43MB PDF，确认 process 返回统一字段和 `status=ready_for_download`。
2. 若 process 失败，查看返回 `code/phase` 定位是写入、校验、还是 source 读取问题。
3. 验证 `/api/jobs/{jobId}/debug` 的 processed 字段与 `process` 返回一致。

## SOP 候选规则

1. process 成功标准应定义为“processed.pdf 已落盘/可回读”，而非“manifest patch 成功”。
2. Preview 环境必须提供 processor 降级路径，确保主链路可验证。
3. process/preview/download 统一使用 canonical processed 字段，避免多命名导致 output missing。

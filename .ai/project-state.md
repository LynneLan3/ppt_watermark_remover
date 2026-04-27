# Project State

> 自动生成的项目状态文件
> 最后更新：2026-04-27 CST

---

## 项目基本信息

- **项目名称**: NotebookLM Watermark Remover
- **当前阶段**: Stage 2 - Beta 上线准备（免费预览确认模式）
- **当前重点**: 修复 Preview process 输出缺失：统一 processed 字段契约 + passthrough fallback 稳定产出
- **算法策略**: 默认 `stable-light-complex-v5`，禁用 v6 micro polish experimental path

---

## 当前工作项

### Active
- [x] 修复 build 失败：移除 next/font/google Geist 字体依赖，改用系统字体
- [x] 修复 Vercel 运行时临时目录不可写：将 process.cwd() 改为 os.tmpdir()
- [x] 确保所有 API 路由都有 nodejs runtime 配置
- [x] 首页主流程使用 /api/jobs/* 链路正确
- [x] 实现 Blob-backed job 持久化存储
- [x] 修复 analyze 404 错误（区分 JOB_NOT_FOUND vs UPLOAD_NOT_FINALIZED）
- [x] 添加 API 路由详细日志
- [x] 更新前端错误显示
- [x] 添加 finalize-upload 路由修复 analyze 409 错误
- [x] 前端添加上传锁防止重复调用
- [x] 前端添加 6 步处理流程可视化
- [x] 修复 analyze 返回 upload_not_finalized 但 source 已存在的误判问题
- [x] 修复 Preview analyze=job_not_found：补齐 jobId 全链路追踪与 finalize 写后回读校验
- [x] 修复 private Blob source.pdf 读取方式，使用 @vercel/blob SDK
- [x] 添加 sourcePdfExists 检查到 debug endpoint
- [x] 修复 analyze 错误码映射，区分 job_not_found / source_pdf_not_found / source_pdf_read_failed
- [x] 添加 SourcePdfNotFoundError 和 SourcePdfReadFailedError 错误类型
- [x] 拆分上传路由，消除同一链路双 `upload-token` 请求混淆（`/upload-token` + `/upload-source`）
- [x] 增加 Vercel 存储强约束：`VERCEL` 且无 `BLOB_READ_WRITE_TOKEN` 返回 `STORAGE_NOT_CONFIGURED`
- [x] 增强 analyze/debug 的 job_not_found 诊断字段（storageBackend、hasBlobToken、expectedManifestPath）
- [x] 完成 Stateless Analyze：body sourcePathname/sourceBlobUrl 优先，manifest 仅 fallback
- [x] 完成 Stateless Process：body source 优先，manifest 写回改为 best-effort
- [x] 新增 upload-and-analyze Beta fallback（4MB 单路由）
- [x] preview/download 增加 blob 直读 fallback，降低 manifest 不可读对用户链路影响
- [x] analyze 按阶段拆分（resolve/read/validate/run/parse/write/patch）并输出 phase/code
- [x] analyze 失败响应增加 runtime/error 诊断字段（Preview/ENABLE_JOB_DEBUG=1 展开）
- [x] analyze 增加 Python runtime/script/dependency 检查，精确错误码返回
- [x] Preview 自动 JS analyze fallback（python runtime/script/dependency 异常时）
- [x] process 增加 Preview passthrough-fallback（Python 不可用时返回原 PDF）
- [x] 新增本地复现脚本：`pnpm analyze:debug -- <path-to-pdf>`
- [x] 统一 process 成功响应字段：processedPathname/processedBlobUrl/processedSize/processedContentType/processMode/status
- [x] process source 解析改为 body 优先，manifest fallback；缺失时返回 process_source_missing
- [x] process passthrough-fallback 改为可靠 Blob 写入+回读校验，避免 processed output missing
- [x] preview/download 读取优先级统一为 processedPathname -> job.processedPathname -> 默认路径 -> 旧字段兼容
- [x] debug endpoint 增加 processedPathname/processedPdfExists/processedSize/processMode/error 状态

### Pending
- [ ] Vercel Preview 部署验证主流程（create -> upload-token -> upload-source -> finalize-upload -> analyze -> process）
- [ ] 验证下载后 markDownloaded 状态更新

### Blocked
- 无

---

## 关键指标

| 指标 | 当前值 | 目标值 | 状态 |
|------|--------|--------|------|
| `pnpm lint` | pass | pass | 🟢 达标 |
| `pnpm build` | pass（含 Turbopack tracing warnings） | pass | 🟢 达标 |
| 正式用户流程 | 首屏上传 -> Remove -> 全屏 processing -> 双栏同步预览 -> 门控下载 | 可用 | 🟢 本地通过 |
| 上传链路一致性 | create/upload/finalize/analyze/process 使用同一 jobId 与同一路径 | 一致 | 🟢 本地代码校验通过 |
| Stateless 容错 | manifest 读失败时 analyze/process 可继续（需 body source） | 启用 | 🟢 本地代码校验通过 |
| Analyze 诊断可观测性 | analyze 失败返回 phase/code/runtime/error 结构化字段 | 启用 | 🟢 本地代码校验通过 |
| Process 输出可用性 | Python 不可用时仍可生成 `jobs/{jobId}/processed.pdf` | 启用 | 🟢 本地代码校验通过 |

---

## 最近修改

| 时间 | 文件 | 修改类型 | 说明 |
|------|------|----------|------|
| 2026-04-27 | lib/blob-storage/job-store.ts | modify | 添加 sourcePdfExists 检查；添加 SourcePdfNotFoundError 和 SourcePdfReadFailedError 错误类型；修复 getSourcePdfBuffer 抛出具体错误而非返回 null |
| 2026-04-27 | lib/jobs/repository.ts | modify | 导出新的错误类型和 sourcePdfExists；更新 getSourcePdfForProcessing 抛出具体错误 |
| 2026-04-27 | lib/jobs/types.ts | modify | 添加 source_pdf_not_found 和 source_pdf_read_failed 错误码 |
| 2026-04-27 | lib/jobs/service.ts | modify | analyzeJobV1 正确处理 SourcePdfNotFoundError 和 SourcePdfReadFailedError；不再检查 buffer 是否为 null |
| 2026-04-27 | app/api/jobs/[jobId]/analyze/route.ts | modify | 添加 SourcePdfNotFoundError 和 SourcePdfReadFailedError 的错误处理映射 |
| 2026-04-27 | app/api/jobs/[jobId]/debug/route.ts | modify | 添加 sourcePdfExists 检查和更多诊断字段 |
| 2026-04-27 | app/api/jobs/[jobId]/analyze/route.ts | modify | upload_not_finalized 错误返回添加诊断字段（status, hasSourceBlobUrl, hasSourcePathname, sourcePathname） |
| 2026-04-27 | app/api/jobs/[jobId]/process/route.ts | modify | upload_not_finalized 错误返回添加诊断字段 |
| 2026-04-27 | app/api/jobs/[jobId]/finalize-upload/route.ts | create | 新的 finalize-upload API 路由，将 blob URL 写入 job manifest |
| 2026-04-27 | app/api/jobs/[jobId]/debug/route.ts | create | 调试路由，返回 job 状态和 blob 元数据 |
| 2026-04-27 | components/tool/upload-hero.tsx | modify | 添加 6 步处理流程可视化；调用 finalize-upload 后再调用 analyze；上传锁防止重复 |
| 2026-04-27 | lib/blob-storage/job-store.ts | modify | 所有 put 调用添加 allowOverwrite: true 修复 Blob pathname 冲突 |
| 2026-04-27 | lib/jobs/repository.ts | modify | persistAnalyzeOutputs 和 persistProcessOutput 中的 put 添加 allowOverwrite: true |
| 2026-04-27 | lib/jobs/types.ts | modify | 添加 blob_path_conflict 和 upload_not_finalized 错误码 |
| 2026-04-27 | lib/jobs/api.ts | modify | 添加 blob_path_conflict 错误映射 |
| 2026-04-27 | app/api/jobs/upload-token/route.ts | modify | 捕获 Blob already exists 错误返回 409 blob_path_conflict；错误消息脱敏处理 |
| 2026-04-27 | app/api/jobs/upload-source/route.ts | create | 新增上传源文件路由，分离 upload-token 与实际文件上传 |
| 2026-04-27 | components/tool/upload-hero.tsx | modify | 增加 jobId 全链路 debug step、currentJobRef/currentFileKeyRef、防重复上传与 upload-source 调用 |
| 2026-04-27 | app/api/jobs/[jobId]/finalize-upload/route.ts | modify | 强制 readJob 存在校验、写后回读校验、返回 manifestPath 与 FINALIZE_WRITE_FAILED |
| 2026-04-27 | app/api/jobs/[jobId]/analyze/route.ts | modify | job_not_found 响应增加 storage 诊断字段 |
| 2026-04-27 | app/api/jobs/[jobId]/debug/route.ts | modify | job 存在/不存在都返回 storage 诊断字段和 expectedManifestPath |
| 2026-04-27 | lib/jobs/repository.ts | modify | 增加 VERCEL+无 token 的 STORAGE_NOT_CONFIGURED、storage diagnostics、最小 20 分钟 TTL 保证 |
| 2026-04-27 | lib/jobs/api.ts | modify | 增加 STORAGE_NOT_CONFIGURED 错误映射 |
| 2026-04-27 | lib/blob-storage/job-store.ts | modify | 导出 manifest path 与 blob token 检查方法，统一路径诊断 |
| 2026-04-27 | lib/jobs/types.ts | modify | 增加 FINALIZE_WRITE_FAILED / STORAGE_NOT_CONFIGURED 错误码 |
| 2026-04-27 | .ai/project-state.md | modify | 更新项目状态 |
| 2026-04-27 | app/api/jobs/[jobId]/analyze/route.ts | modify | 改为 body source 优先的 Stateless analyze；新增 source_pdf_not_found/source_pdf_read_failed/pdf_analyze_failed/analyze_failed 错误映射 |
| 2026-04-27 | app/api/jobs/[jobId]/process/route.ts | modify | 增加 Stateless process fallback，manifest 失败时仍可继续处理 |
| 2026-04-27 | lib/jobs/service.ts | modify | 新增 analyzeJobV1Stateless/processJobStateless，manifest 写回 best-effort |
| 2026-04-27 | lib/blob-storage/source-reader.ts | create | 新增基于 Vercel Blob SDK 的 private source.pdf 读取 helper |
| 2026-04-27 | app/api/jobs/upload-and-analyze/route.ts | create | 新增 4MB 限制的单路由 Beta fallback |
| 2026-04-27 | app/api/jobs/[jobId]/preview/route.ts | modify | 增加 `jobs/{jobId}/processed.pdf` Blob 直读 fallback |
| 2026-04-27 | app/api/jobs/[jobId]/download/route.ts | modify | 增加 `jobs/{jobId}/processed.pdf` Blob 直读 fallback |
| 2026-04-27 | components/tool/upload-hero.tsx | modify | analyze/process 调用强制携带 finalize 返回 source 信息；process 状态同步失败时容错进入预览 |
| 2026-04-27 | app/api/jobs/[jobId]/finalize-upload/route.ts | modify | finalize 响应增加 sourcePathname/sourceBlobUrl 供后续无状态调用 |
| 2026-04-27 | lib/jobs/types.ts | modify | 增加 source_pdf_not_found/source_pdf_read_failed/pdf_analyze_failed/analyze_failed 错误码 |
| 2026-04-27 | lib/jobs/api.ts | modify | 增加 source 读取和 analyze 失败的错误映射 |
| 2026-04-27 | app/api/jobs/[jobId]/analyze/route.ts | modify | analyze 阶段化错误码与安全诊断字段；Preview 自动启用 JS fallback |
| 2026-04-27 | lib/jobs/service.ts | modify | analyze 阶段 trace、Python runtime/script/dependency 检查、JS fallback；process passthrough-fallback |
| 2026-04-27 | lib/jobs/js-analyze-fallback.ts | create | 新增纯 JS analyze fallback，读取页数并返回最小 analysis |
| 2026-04-27 | app/api/jobs/[jobId]/process/route.ts | modify | process stateless 响应增加 processMode/warning，支持 passthrough-fallback 输出 |
| 2026-04-27 | components/tool/upload-hero.tsx | modify | View processing steps 显示 analyze 阶段细节、失败 phase/code |
| 2026-04-27 | scripts/debug-analyze.mjs | create | 本地 analyze 诊断脚本（bytes/analyzer/python/script/dependency） |
| 2026-04-27 | package.json | modify | 新增 `analyze:debug` 脚本命令 |
| 2026-04-27 | app/api/jobs/[jobId]/process/route.ts | modify | process 改为 body source 优先 + 统一成功字段 + 结构化失败诊断 |
| 2026-04-27 | lib/jobs/service.ts | modify | processJobStateless 统一输出字段、Blob 写入/回读校验、可靠 passthrough fallback |
| 2026-04-27 | app/api/jobs/[jobId]/preview/route.ts | modify | 统一 processedPathname 优先读取链路并兼容旧字段 |
| 2026-04-27 | app/api/jobs/[jobId]/download/route.ts | modify | 统一 processedPathname 优先读取链路并兼容旧字段 |
| 2026-04-27 | app/api/jobs/[jobId]/debug/route.ts | modify | 增加 processedPathname/processedPdfExists/processedSize/processMode 调试字段 |
| 2026-04-27 | components/tool/upload-hero.tsx | modify | process 请求透传 source+analysis；保存 processMode/warning/processedPathname 并继续 preview/download |
| 2026-04-27 | lib/jobs/types.ts | modify | 新增 process_source_missing/processed_pdf_* /pdf_processor_* 错误码与 JobRecord processed 字段 |
| 2026-04-27 | AGENTS.md | modify | 更新为 Stage 2 Beta，明确允许范围和禁止事项 |
| 2026-04-27 | docs/prd.md | modify | 更新为 Stage 2 Beta 目标和成功标准 |
| 2026-04-27 | .ai/project-state.md | modify | 更新项目状态 |
| 2026-04-27 | .ai/devlog/2026-04-27-add-finalize-upload-route.md | create | 记录 finalize-upload 路由实现和 analyze 409 修复 |
| 2026-04-27 | .ai/devlog/2026-04-27-fix-blob-conflict.md | create | 记录 Blob pathname 冲突和重复上传修复过程 |

---

## 未解决问题

1. `next build` 仍有 Turbopack 动态路径 tracing warnings（manual-review/job-path 动态路径相关，不阻塞上线）。

---

## 下一步建议

1. 部署到 Vercel Preview 环境验证主流程。
2. 监控 /tmp 目录空间使用情况。

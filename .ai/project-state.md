# Project State

> 自动生成的项目状态文件
> 最后更新：2026-04-27 CST

---

## 项目基本信息

- **项目名称**: NotebookLM Watermark Remover
- **当前阶段**: Stage 2 - Beta 上线准备（免费预览确认模式）
- **当前重点**: 修复上线阻断问题：build 失败、Vercel 临时目录不可写
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

### Pending
- [ ] Vercel Preview 部署验证主流程（上传 -> 处理 -> 预览 -> 下载）
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

---

## 最近修改

| 时间 | 文件 | 修改类型 | 说明 |
|------|------|----------|------|
| 2026-04-27 | lib/blob-storage/job-store.ts | create | 实现 Vercel Blob-backed job 持久化存储：readJob, writeJob, saveSourcePdf, getSourcePdfBuffer 等 |
| 2026-04-27 | lib/jobs/repository.ts | modify | 集成 Blob 存储，支持根据 BLOB_READ_WRITE_TOKEN 自动切换存储后端 |
| 2026-04-27 | lib/jobs/types.ts | modify | 添加 sourceBlobUrl, sourcePathname, sourceSize, sourceContentType, processOutputBlobUrl 等字段 |
| 2026-04-27 | lib/jobs/api.ts | modify | 添加 JobNotFoundError 和 UploadNotFinalizedError 错误映射 |
| 2026-04-27 | lib/jobs/service.ts | modify | 更新 analyzeJobV1 和 processJob 支持 Blob 存储，下载 source PDF 到临时文件 |
| 2026-04-27 | app/api/jobs/create/route.ts | modify | 添加详细日志记录 |
| 2026-04-27 | app/api/jobs/upload-token/route.ts | modify | 添加详细日志记录 |
| 2026-04-27 | app/api/jobs/[jobId]/analyze/route.ts | modify | 修复错误处理，区分 JOB_NOT_FOUND (404) 和 UPLOAD_NOT_FINALIZED (409)，添加详细日志 |
| 2026-04-27 | app/api/jobs/[jobId]/process/route.ts | modify | 添加详细日志和错误处理 |
| 2026-04-27 | components/tool/upload-hero.tsx | modify | 添加错误 code 映射，显示用户友好的错误信息 |
| 2026-04-27 | AGENTS.md | modify | 添加 Blob-Backed Job Storage (Vercel Production) 章节 |
| 2026-04-27 | package.json | modify | 添加 @vercel/blob 依赖 |
| 2026-04-27 | .ai/project-state.md | modify | 更新项目状态 |
| 2026-04-27 | .ai/devlog/2026-04-27-fix-analyze-404.md | create | 记录 analyze 404 修复过程 |

---

## 未解决问题

1. `next build` 仍有 Turbopack 动态路径 tracing warnings（manual-review/job-path 动态路径相关，不阻塞上线）。

---

## 下一步建议

1. 部署到 Vercel Preview 环境验证主流程。
2. 监控 /tmp 目录空间使用情况。

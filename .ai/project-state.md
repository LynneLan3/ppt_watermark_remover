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
- [x] 添加 finalize-upload 路由修复 analyze 409 错误
- [x] 前端添加上传锁防止重复调用
- [x] 前端添加 6 步处理流程可视化
- [x] 修复 analyze 返回 upload_not_finalized 但 source 已存在的误判问题

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
| 2026-04-27 | lib/jobs/service.ts | modify | analyzeJobV1 和 processJob 改用 sourceBlobUrl && sourcePathname 判断上传是否完成 |
| 2026-04-27 | lib/jobs/repository.ts | modify | getSourcePdfForProcessing 改用 sourceBlobUrl && sourcePathname 判断上传是否完成 |
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

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
| 2026-04-27 | app/layout.tsx | modify | 移除 next/font/google Geist/Geist_Mono 字体导入，改用系统字体，修复离线构建失败 |
| 2026-04-27 | lib/server/temp-storage/paths.ts | modify | getTempJobsRoot() 改为使用 os.tmpdir() 替代 process.cwd()，修复 Vercel 不可写问题 |
| 2026-04-27 | lib/storage/job-paths.ts | modify | getJobsRoot() 改为使用 os.tmpdir() 替代 process.cwd()，修复 Vercel 不可写问题 |
| 2026-04-27 | .ai/devlog/2026-04-27-fix-deployment-blockers.md | create | 记录上线阻断问题修复过程 |
| 2026-04-27 | .ai/project-state.md | modify | 更新当前状态为上线阻断修复完成 |
| 2026-04-27 | next.config.ts | modify | 移除 turbopack.root: process.cwd() 配置，修复 Vercel NFT tracing 错误导致构建失败 |

---

## 未解决问题

1. `next build` 仍有 Turbopack 动态路径 tracing warnings（manual-review/job-path 动态路径相关，不阻塞上线）。

---

## 下一步建议

1. 部署到 Vercel Preview 环境验证主流程。
2. 监控 /tmp 目录空间使用情况。

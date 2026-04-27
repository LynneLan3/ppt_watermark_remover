# Devlog

> 日期：2026-04-25
> 任务：构建 `/app/manual-review` 内部手动测试闭环（不做算法微调）

---

## 任务目标

搭建本地/测试环境可用的人工验收闭环：上传 PDF 后自动处理，浏览器内对比 original/processed，下载 `processed.pdf` 与 `process-report.json`，并按页人工标注结果。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| app/app/manual-review/page.tsx | create | 新增内测页路由与 env 开关（未开启时 404） |
| components/manual-review/manual-review-page.tsx | create | 新增前端闭环页面（上传/状态/对比预览/缩略图/下载/人工标注） |
| lib/server/manual-review/service.ts | create | 新增 manual-review 作业服务与异步 Python 执行 |
| app/api/manual-review/jobs/route.ts | create | POST 上传并创建作业 |
| app/api/manual-review/jobs/[jobId]/route.ts | create | GET 查询作业状态 |
| app/api/manual-review/jobs/[jobId]/original.pdf/route.ts | create | 下载 original.pdf |
| app/api/manual-review/jobs/[jobId]/processed.pdf/route.ts | create | 下载 processed.pdf |
| app/api/manual-review/jobs/[jobId]/process-report.json/route.ts | create | 下载 process-report.json |
| app/api/manual-review/jobs/[jobId]/logs.txt/route.ts | create | 下载 logs.txt |
| app/api/manual-review/jobs/[jobId]/debug/[...artifactPath]/route.ts | create | 下载 debug artifacts |
| python/process_raster_watermark_v1.py | modify | 新增 `enableSeamMicroPolish` 开关并默认关闭 |
| scripts/manual-review-clean.mjs | create | 清理 `tmp/manual-review` |
| package.json | modify | 新增 `manual-review:clean` 脚本 |
| .gitignore | modify | 忽略 `tmp/manual-review` |
| docs/manual-review.md | create | 补充环境变量、目录和真实 Python 调用命令 |
| .ai/project-state.md | modify | 更新当前状态、关键指标、最近修改 |

---

## 每个文件修改说明

### 文件 1: `lib/server/manual-review/service.ts`

**修改前**:
```ts
// 无 manual-review 作业服务
```

**修改后**:
```ts
export async function createManualReviewJob(...) { ... }
export async function getManualReviewJobResponse(jobId: string) { ... }
async function startManualReviewProcessing(jobId: string) { ... }
```

**原因**:
提供独立内测链路：临时目录落盘、异步跑 Python、轮询状态、日志与 debug artifacts 聚合。

### 文件 2: `components/manual-review/manual-review-page.tsx`

**修改前**:
```tsx
// 无 manual-review 页面
```

**修改后**:
```tsx
<ManualReviewPageClient ...>
  // 上传即处理
  // 状态机: idle/uploading/uploaded/rendering-preview/processing/completed/failed
  // 并排预览 + 缩略图同步 + 缩放
  // 下载区 + 按页 localStorage 标注
</ManualReviewPageClient>
```

**原因**:
满足“由人工直接看当前稳定算法结果再决定上线”的核心目标。

### 文件 3: `app/api/manual-review/jobs/*`

**修改前**:
```ts
// 无 /api/manual-review/jobs 系列接口
```

**修改后**:
```ts
POST /api/manual-review/jobs
GET  /api/manual-review/jobs/:jobId
GET  /api/manual-review/jobs/:jobId/original.pdf
GET  /api/manual-review/jobs/:jobId/processed.pdf
GET  /api/manual-review/jobs/:jobId/process-report.json
GET  /api/manual-review/jobs/:jobId/logs.txt
GET  /api/manual-review/jobs/:jobId/debug/:artifactPath
```

**原因**:
建立页面前后端闭环，支持上传处理、状态追踪、结果与日志下载。

### 文件 4: `python/process_raster_watermark_v1.py`

**修改前**:
```python
micro_pixels, micro_verification, micro_diagnostics = try_apply_seam_micro_polish(...)
```

**修改后**:
```python
if enable_seam_micro_polish:
    ... try_apply_seam_micro_polish(...)
else:
    micro_diagnostics = default_seam_micro_polish_diagnostics()
    micro_diagnostics["seamMicroPolishRejectedReason"] = "disabled_by_config"
```

**原因**:
本轮要求是“可视化验收闭环”，不是继续追 v6 micro polish 指标；因此加开关并默认关闭。

### 文件 5: `docs/manual-review.md`, `package.json`, `scripts/manual-review-clean.mjs`, `.gitignore`

**修改前**:
```text
无 manual-review 独立文档与清理脚本
```

**修改后**:
```bash
pnpm manual-review:clean
```
```text
tmp/manual-review/{jobId}/...
```

**原因**:
提供可重复本地测试操作与清理能力。

---

## 测试命令

```bash
pnpm lint
pnpm build
```

---

## 测试结果

- `pnpm lint`: **pass**
- `pnpm build`: **pass**（Turbopack 有动态路径 tracing warnings，但构建成功）
- 生成路由包含：
  - `/app/manual-review`
  - `/api/manual-review/jobs`
  - `/api/manual-review/jobs/[jobId]`
  - `/api/manual-review/jobs/[jobId]/original.pdf`
  - `/api/manual-review/jobs/[jobId]/processed.pdf`
  - `/api/manual-review/jobs/[jobId]/process-report.json`
  - `/api/manual-review/jobs/[jobId]/logs.txt`
  - `/api/manual-review/jobs/[jobId]/debug/[...artifactPath]`

**指标前后对比**:
- 算法核心指标：本轮未变更（不做微调）
- 工程可用性：新增人工闭环页面与 API，满足上传->处理->预览->下载->标注流程

---

## 未解决问题

1. `next build` 对动态文件路径有 tracing warnings（不阻塞本地使用）。
2. 页面当前实现为并排对比，未实现 before/after slider（需求里允许“时间不够先并排”）。

---

## 下一步建议

1. 用真实样本在 `/app/manual-review` 做人工标注，形成上线判断结论。
2. 若发现稳定可复现问题，再基于标注回流定向修复。
3. 如需减少构建 warning，可后续再做 path tracing 优化。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 在算法收敛期先搭建人工可视验收闭环，再决定是否继续微调指标 | 本轮 manual-review 交付 | 1 | 暂不升级 |
| 内测闭环页需默认关闭并受环境变量控制，不作为公开入口 | 本轮 `/app/manual-review` | 1 | 暂不升级 |

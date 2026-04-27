# Devlog

> 日期：2026-04-25
> 任务：Beta 上线准备（免费预览确认模式）

---

## 任务目标

在不继续算法微调和不做大算法改动的前提下，把首页改造成可公开 Beta 的“上传后自动处理 + 预览确认后下载”流程，并补齐限制、反馈、隐私文案与内部入口隔离。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| components/tool/upload-hero.tsx | modify | 重构首页正式用户流程：自动处理、前后预览、逐页查看、预览后下载、按页反馈 |
| components/tool/pdf-single-page-preview.tsx | modify | 增加 preview 渲染成功/失败回调用于下载门控 |
| app/api/jobs/[jobId]/preview/route.ts | create | 新增 cleaned PDF 预览接口（不触发下载状态） |
| app/api/jobs/[jobId]/feedback/route.ts | create | 新增反馈接口，写入 `tmp/user-feedback/{jobId}.jsonl` |
| lib/storage/upload.ts | modify | 上传限制改为 PDF + 50MB + 30页，增加 PDF 解析失败提示 |
| lib/server/api/upload-validation.ts | modify | 另一套上传校验同步为 50MB + 30页 |
| app/api/temp-jobs/upload/route.ts | modify | 适配异步上传校验 |
| app/api/manual-review/jobs/route.ts | modify | 适配异步上传校验 |
| lib/jobs/service.ts | modify | 固定算法 profile，且 `enableSeamMicroPolish=false` |
| python/process_raster_watermark_v1.py | modify | report 增加 `algorithmProfile` 字段 |
| lib/jobs/api.ts | modify | 上传校验错误映射补充（页数超限/解析失败） |
| lib/jobs/types.ts | modify | `ProcessReportV2` 增加 `algorithmProfile?` |
| content/pages/home-tool.ts | modify | 首页 Beta 文案、限制文案、流程文案同步 |
| content/pages/privacy-policy.ts | modify | 增加临时处理/不训练/复杂页面残留/限制说明 |
| content/pages/terms.ts | modify | 增加 Beta 限制与复杂页面残留声明 |
| content/pages/disclaimer.ts | modify | 增加复杂页面可能残留声明 |
| lib/server/manual-review/service.ts | modify | `/app/manual-review` 仅 `ENABLE_MANUAL_REVIEW=true` 可访问，micro polish 固定关闭 |
| docs/manual-review.md | modify | 同步 v6 micro polish 冻结说明 |
| .ai/project-state.md | modify | 更新当前状态、关键指标、最近修改 |

---

## 每个文件修改说明

### 文件 1: `components/tool/upload-hero.tsx`

**修改前**:
```tsx
// 用户需要手动点击 Analyze / Process / Download
// cleaned 预览通常在下载后才出现
// Debug object-level 面板直接混在首页
```

**修改后**:
```tsx
// Upload and process 一键流程（上传后自动处理）
// Processed 预览成功后才允许下载
// 逐页预览 + 页面反馈按钮（5类）+ note
// 反馈 POST 到 /api/jobs/:jobId/feedback
```

**原因**:
匹配 Beta 正式路径：预览确认优先，不再给正式用户展示调试流。

### 文件 2: `app/api/jobs/[jobId]/preview/route.ts`

**修改前**:
```ts
// 无独立 preview 接口；下载接口会触发 downloaded 状态
```

**修改后**:
```ts
GET /api/jobs/:jobId/preview
// 校验 ready_for_download/downloaded
// inline 返回 processed.pdf 供前端 preview
```

**原因**:
实现“先预览再下载”门控，避免预览动作混同下载动作。

### 文件 3: `app/api/jobs/[jobId]/feedback/route.ts`

**修改后**:
```ts
POST /api/jobs/:jobId/feedback
// payload: page, feedbackType, note
// 输出: tmp/user-feedback/{jobId}.jsonl
```

**原因**:
提供 Beta 反馈入口，不引入数据库，满足先本地落盘的需求。

### 文件 4: `lib/storage/upload.ts` 与 `lib/server/api/upload-validation.ts`

**修改前**:
```ts
MAX_UPLOAD_BYTES = 25MB
// 无页数限制
```

**修改后**:
```ts
MAX_UPLOAD_BYTES = 50MB
MAX_UPLOAD_PAGES = 30
await PDFDocument.load(...) 后校验 pageCount
```

**原因**:
满足本轮 Beta 限制条件，并在超限时给明确错误。

### 文件 5: `lib/jobs/service.ts` 与 `python/process_raster_watermark_v1.py`

**修改前**:
```ts
rasterProcessConfig 未显式写 enableSeamMicroPolish
report 未明确 algorithmProfile
```

**修改后**:
```ts
algorithmProfile: stable-light-complex-v5
rasterProcessConfig.enableSeamMicroPolish = false
```

```py
report_payload["algorithmProfile"] = algorithm_profile
```

**原因**:
冻结算法路径，避免 v6 micro polish 误开启，并让页面/report 可追踪算法 profile。

### 文件 6: `lib/server/manual-review/service.ts`

**修改前**:
```ts
isManualReviewEnabled = ENABLE_MANUAL_REVIEW=true || 非 production
```

**修改后**:
```ts
isManualReviewEnabled = ENABLE_MANUAL_REVIEW === "true"
getManualReviewMicroPolishEnabled() => false
```

**原因**:
确保内部 manual-review 仅显式开启可访问，正式用户不暴露 debug 入口。

### 文件 7: 文案文件 (`content/pages/home-tool.ts`, `privacy-policy.ts`, `terms.ts`, `disclaimer.ts`)

**修改前**:
```text
文案偏通用，限制与残留预期表达不够集中
```

**修改后**:
```text
- Preview the cleaned result before downloading.
- Works best for NotebookLM PDF exports with bottom-right marks.
- Complex diagrams or dense backgrounds may leave slight residue.
- Review every page before downloading.
- 明确 50MB / 30页 / temporary / no-training
```

**原因**:
将产品定位从“绝对承诺”改为“免费预览确认”的 Beta 真实承诺。

---

## 测试命令

```bash
pnpm lint
pnpm build
```

---

## 测试结果

- `pnpm lint`: **pass**
- `pnpm build`: **pass**（存在 Turbopack tracing warnings，不阻塞）
- 新增路由构建成功：
  - `/api/jobs/[jobId]/preview`
  - `/api/jobs/[jobId]/feedback`

---

## 未解决问题

1. `next build` 仍提示 manual-review 相关动态路径 tracing warnings（不阻塞当前 Beta）。
2. 首页仍基于 `api/jobs/*`，未统一到 `temp-jobs` 主链路。

---

## 下一步建议

1. 用真实 NotebookLM PDF 样本进行一次完整 Beta 回归（成功与失败样本各至少 2 份）。
2. 在 Vercel Preview 环境验证 `ENABLE_MANUAL_REVIEW` 关闭时 `/app/manual-review` 不可访问。
3. 收集 `tmp/user-feedback/*.jsonl` 后做第一轮反馈聚合，再决定是否进入下一轮算法优化。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| Beta 上线前将首页从“处理导向”切换为“预览确认导向”，并把下载门控绑定到 preview ready 状态 | 本轮首页流程重构 | 1 | 暂不升级 |
| 不引入数据库的反馈闭环可先落盘 JSONL（jobId/page/feedbackType/note/algorithmProfile）以降低上线复杂度 | 本轮反馈接口 | 1 | 暂不升级 |

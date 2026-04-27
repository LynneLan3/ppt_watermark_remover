# Devlog

> 日期：2026-04-25
> 任务：将 `/app/manual-review` 人工验收结果转成 page-level QA 数据集与失败类型统计

---

## 任务目标

在不改算法核心逻辑的前提下，把手动测试闭环升级为可量化 QA 数据闭环：按页打标、统计失败分布、导出 QA JSON 与 summary，并落盘每页 QA artifacts。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| components/manual-review/manual-review-page.tsx | modify | 升级手动标签、统计面板、local QA JSON 导出、服务器 QA 导出流程 |
| lib/server/manual-review/service.ts | modify | 新增按页 QA artifacts 写入、qa-dataset/qa-summary 生成、失败类型分布统计 |
| app/api/manual-review/jobs/[jobId]/qa/artifacts/route.ts | create | 新增每页 QA artifacts 上传落盘接口 |
| app/api/manual-review/jobs/[jobId]/qa/summary/route.ts | create | 新增 QA summary 生成接口 |
| app/api/manual-review/jobs/[jobId]/qa-dataset.json/route.ts | create | 新增 qa-dataset 下载接口 |
| app/api/manual-review/jobs/[jobId]/qa-summary.json/route.ts | create | 新增 qa-summary 下载接口 |
| docs/manual-review.md | modify | 补充 QA 标签、QA artifacts 目录、QA 导出接口说明 |
| .ai/project-state.md | modify | 更新当前工作项、关键指标和最近修改 |

---

## 每个文件修改说明

### 文件 1: `components/manual-review/manual-review-page.tsx`

**修改前**:
```tsx
// 仅支持 Pass / Needs Fix / Severe Issue
// 无失败类型统计
// 无按页 QA 数据导出与 artifacts 导出
```

**修改后**:
```tsx
// 新增 7 类人工标签：Pass / Minor Residue / Visible Residue / White Patch / Hard Edge / Text/Line Damage / Severe Fail
// 每页 issue tags + note
// 顶部统计：total/pass/fail/passRate/residue/whitePatch/hardEdge/damage/severeFail
// Export QA JSON(local)
// Export QA + Artifacts + Summary(server)
```

**原因**:
把人工判定变成可分析的数据，明确“当前主要失败类型”。

### 文件 2: `lib/server/manual-review/service.ts`

**修改前**:
```ts
// 只有上传处理与 debug artifacts 汇总
```

**修改后**:
```ts
saveManualQaPageArtifacts(...)
buildAndWriteManualQaSummary(...)
resolveQaExportPath(...)
```

**原因**:
实现每页 QA 产物落盘到 `tmp/manual-review/{jobId}/qa/page-{n}/`，并生成 `qa-dataset.json` 与 `qa-summary.json`。

### 文件 3: 新增 QA API routes

**修改后**:
```text
POST /api/manual-review/jobs/:jobId/qa/artifacts
POST /api/manual-review/jobs/:jobId/qa/summary
GET  /api/manual-review/jobs/:jobId/qa-dataset.json
GET  /api/manual-review/jobs/:jobId/qa-summary.json
```

**原因**:
前端可直接触发导出并下载，形成完整 QA 数据闭环。

### 文件 4: `docs/manual-review.md`

**修改后**:
```md
- Manual QA labels
- QA artifacts 输出目录
- QA Export APIs
```

**原因**:
保证本地测试与导出流程可复现、可交接。

---

## 测试命令

```bash
pnpm lint
pnpm build
```

---

## 测试结果

- `pnpm lint`: **pass**
- `pnpm build`: **pass**（存在 Turbopack 动态路径 tracing warnings，但不阻塞）
- 新增路由构建成功：
  - `/api/manual-review/jobs/[jobId]/qa/artifacts`
  - `/api/manual-review/jobs/[jobId]/qa/summary`
  - `/api/manual-review/jobs/[jobId]/qa-dataset.json`
  - `/api/manual-review/jobs/[jobId]/qa-summary.json`

---

## 未解决问题

1. Turbopack 对动态路径访问给出 tracing warnings（不影响功能）。
2. 需要多份真实 PDF 导出后再做跨文件聚合，才能稳定确定下一轮优化优先级。

---

## 下一步建议

1. 用多份真实样本完成按页标注并导出 `qa-summary.json`。
2. 汇总 issue distribution 后，选择最高频失败类型作为下一轮唯一优化目标。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 算法迭代前先建立 page-level QA 数据闭环，避免盲目微调指标 | 本轮 manual-review QA 数据化 | 1 | 暂不升级 |
| 手动验收导出应同时包含标签、备注、per-page 报告字段与截图证据 | 本轮 QA artifacts + summary 导出 | 1 | 暂不升级 |

# 2026-04-27 Stateless Analyze/Process 与 Beta Fallback 改造

## 任务目标

将 analyze/process 从“强依赖 job manifest”改为“无状态优先”，确保 finalize-upload 已返回 source 信息时，不再因 readJob 失败误报 `job_not_found`。

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| app/api/jobs/[jobId]/analyze/route.ts | modify | 改为 body source 优先；readJob 仅 fallback；精确错误码输出 |
| app/api/jobs/[jobId]/process/route.ts | modify | 增加无状态 fallback：body source 存在时不因 manifest 失败中断 |
| lib/jobs/service.ts | modify | 新增 `analyzeJobV1Stateless` 与 `processJobStateless` |
| lib/blob-storage/source-reader.ts | create | 新增 private blob source.pdf 读取 helper（SDK `head/get`） |
| app/api/jobs/[jobId]/finalize-upload/route.ts | modify | 返回 sourcePathname/sourceBlobUrl 供后续 analyze/process 透传 |
| components/tool/upload-hero.tsx | modify | finalize 后强制向 analyze/process 传 source 信息；新增 process 状态同步容错 |
| app/api/jobs/[jobId]/preview/route.ts | modify | manifest 不可读时 fallback 直读 `jobs/{jobId}/processed.pdf` |
| app/api/jobs/[jobId]/download/route.ts | modify | manifest 不可读时 fallback 直读 `jobs/{jobId}/processed.pdf` |
| app/api/jobs/upload-and-analyze/route.ts | create | 4MB 单路由 Beta fallback（create+upload+analyze） |
| lib/jobs/types.ts | modify | 增加 `source_pdf_not_found/source_pdf_read_failed/pdf_analyze_failed/analyze_failed` |
| lib/jobs/api.ts | modify | 新增相关错误映射 |
| .ai/project-state.md | modify | 同步本轮状态 |

## 每个文件修改说明

### 1) Stateless Analyze（核心）

修改前（强依赖 manifest）：
```ts
const result = await analyzeJobV1(jobId)
```

修改后（body source 优先）：
```ts
const body = await request.json().catch(() => ({}))
let sourcePathname = body.sourcePathname
let sourceBlobUrl = body.sourceBlobUrl

let job = null
try { job = await readJob(jobId) } catch { job = null }

if (!sourcePathname && job?.sourcePathname) sourcePathname = job.sourcePathname
if (!sourceBlobUrl && job?.sourceBlobUrl) sourceBlobUrl = job.sourceBlobUrl
```

只有 source 全缺失时才返回 `upload_not_finalized`（或 body+job 都无时 `job_not_found`）。

### 2) Source Reader（SDK 读取 private blob）

新增 `lib/blob-storage/source-reader.ts`：
- `readSourcePdfBuffer({ sourcePathname, sourceBlobUrl })`
- 使用 `@vercel/blob` 的 `head/get`
- 错误区分：
  - `SourcePdfNotFoundError`
  - `SourcePdfReadFailedError`

### 3) Stateless Process（核心）

新增 `processJobStateless`：
- source 来自 body（fallback manifest）
- 运行 python process
- 结果写 blob
- 回写 manifest 采用 best-effort（失败仅 warn，不阻塞主链路）

route 中策略：
1. 先走 legacy `processJob`。
2. 若失败且 body 有 source，则自动 fallback 到 `processJobStateless`。

### 4) finalize -> analyze/process 透传 source

前端 `upload-hero` 现在会：
- 从 finalize 响应取 `sourcePathname/sourceBlobUrl`
- analyze/process 请求体都带 source 信息
- 若 finalize 响应缺少 source，直接阻断，不进入 analyze

### 5) preview/download 容错

当 readJob 或状态检查失败时，新增 blob 直读 fallback：
- `jobs/{jobId}/processed.pdf`

### 6) Beta fallback route

新增 `POST /api/jobs/upload-and-analyze`：
- multipart `file`
- 4MB 限制
- 单请求内 create + upload + analyze
- 用于 Preview/小文件兜底验证

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

1. 尚未在 Preview 实网验证 0.43MB PDF 的端到端结果（本地构建与类型检查已通过）。

## 下一步建议

1. Preview 部署后按链路验证：`create -> upload-token -> upload-source -> finalize-upload -> analyze -> process`。
2. 若 analyze 失败，确认返回字段包含：`code/jobId/hasBodySourcePathname/hasBodySourceBlobUrl/sourcePathname/jobManifestExists/sourcePdfExists`。
3. 若仍有偶发链路失败，前端可直接提供 `upload-and-analyze` 按钮进行 beta 兜底验证。

## SOP 候选规则

1. Analyze/Process 优先消费 body 的 source 信息，manifest 仅做可选补充。
2. private blob 读取必须走 SDK（`head/get`），禁止直接 fetch private URL。
3. 影响主链路的 manifest 写入必须降级为 best-effort，避免阻塞用户处理与下载。

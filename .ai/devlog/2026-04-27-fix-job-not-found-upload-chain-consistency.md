# 2026-04-27 修复 Preview job_not_found 与上传链路一致性

## 任务目标

修复 Preview 环境中 `analyze` 从 `upload_not_finalized` 变为 `job_not_found` 的问题，确保同一上传链路的 jobId、repository、manifest path 一致，并消除双 `upload-token` 请求歧义。

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| components/tool/upload-hero.tsx | modify | 增加全链路 jobId debug step、`uploadingRef` + `currentJobRef` + `currentFileKeyRef` 防重复、上传请求改为 `/api/jobs/upload-source` |
| app/api/jobs/upload-token/route.ts | modify | 仅负责签发 token，不再处理 multipart 上传 |
| app/api/jobs/upload-source/route.ts | create | 新增独立文件上传路由（multipart） |
| app/api/jobs/[jobId]/finalize-upload/route.ts | modify | 强制先 `readJob`、写后回读校验、返回 `manifestPath` 与 `FINALIZE_WRITE_FAILED` |
| app/api/jobs/[jobId]/analyze/route.ts | modify | `job_not_found` 返回 storage 诊断字段 |
| app/api/jobs/[jobId]/debug/route.ts | modify | job 不存在时仍返回 `storageBackend/hasBlobToken/expectedManifestPath/jobManifestExists` |
| lib/jobs/repository.ts | modify | 增加 `StorageNotConfiguredError`、`getStorageDiagnostics`、Vercel 无 token 禁止 local fallback、最小 20 分钟 retention |
| lib/jobs/api.ts | modify | 增加 `STORAGE_NOT_CONFIGURED` 映射 |
| lib/blob-storage/job-store.ts | modify | 导出 `getJobManifestPathname` 和 `hasBlobReadWriteToken` |
| lib/jobs/types.ts | modify | 增加 `STORAGE_NOT_CONFIGURED`、`FINALIZE_WRITE_FAILED` 错误码 |
| .ai/project-state.md | modify | 同步当前状态与最近修改 |

## 每个文件修改说明

### 1) components/tool/upload-hero.tsx

修改前（问题）：
```ts
const tokenResp = await fetch('/api/jobs/upload-token', ...)
const uploadResp = await fetch('/api/jobs/upload-token', { method: 'POST', body: uploadForm })
```

修改后（修复）：
```ts
const tokenResp = await fetch('/api/jobs/upload-token', ...)
const uploadResp = await fetch('/api/jobs/upload-source', { method: 'POST', body: uploadForm })
```

并新增：
- `currentJobRef` / `currentFileKeyRef` 防重复 job 创建
- 每步 debug message：`createJob returned jobId`、`upload-token using jobId`、`Blob upload returned ...`、`finalize/analyze URL jobId`

原因：
- 避免 Network 里同一 URL 看起来重复触发
- 强化同链路 jobId 可观测性，直接定位闭包/重复触发问题

### 2) app/api/jobs/[jobId]/finalize-upload/route.ts

修改前（问题）：
```ts
await writeJobMetadata(updatedJob)
return jobOk('Upload finalized.', ...)
```

修改后（修复）：
```ts
await writeJobMetadata(updatedJob)
const readBack = await readJob(jobId)
if (!readBack.sourceBlobUrl || !readBack.sourcePathname || readBack.status !== 'uploaded') {
  return jobError({ httpStatus: 500, code: 'FINALIZE_WRITE_FAILED', ... })
}
```

并在响应中返回：
```json
{
  "ok": true,
  "jobId": "...",
  "status": "uploaded",
  "hasSourceBlobUrl": true,
  "hasSourcePathname": true,
  "manifestPath": "jobs/{jobId}/job.json"
}
```

原因：
- 防止 finalize 表面成功但 manifest 实际不可读/未落盘

### 3) lib/jobs/repository.ts

新增：
```ts
if (process.env.VERCEL && !hasBlobReadWriteToken()) {
  throw new StorageNotConfiguredError()
}
```

并提供：
- `resolveStorageBackend()`
- `getStorageDiagnostics(jobId)`

原因：
- 在 Vercel 上强制走 Blob，避免 create/finalize 与 analyze 读写不同存储后端

### 4) app/api/jobs/[jobId]/analyze/route.ts 与 debug/route.ts

`job_not_found` 时新增诊断字段：
```json
{
  "jobId": "...",
  "storageBackend": "blob|local",
  "hasBlobToken": true,
  "expectedManifestPath": "jobs/{jobId}/job.json"
}
```

原因：
- 直接确认 analyze/debug 实际读取的路径与存储后端

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

1. 还未在 Preview 实际复跑 0.43MB PDF 端到端链路（本地构建通过，待线上网络验证）。

## 下一步建议

1. Preview 重新部署后，用全新浏览器会话上传新文件，确认网络顺序：`create -> upload-token -> upload-source -> finalize-upload -> analyze -> process`。
2. 若 analyze 仍 404，立即对比：analyze 响应诊断字段 + `/api/jobs/{jobId}/debug` + finalize 响应中的 `jobId/manifestPath`。

## SOP 候选规则

1. 上传流程拆分为“token 签发”与“源文件上传”独立路由，避免同 URL 双请求误判为重复触发。
2. finalize-upload 必须执行“写后回读”并将 `manifestPath` 回传到前端调试面板。
3. Vercel 环境缺 `BLOB_READ_WRITE_TOKEN` 时必须硬失败（`STORAGE_NOT_CONFIGURED`），禁止 silent fallback 到 local。

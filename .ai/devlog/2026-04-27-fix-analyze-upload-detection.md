# 2026-04-27 修复 analyze upload_not_finalized 误判问题

## 任务目标

修复 analyze API 在 sourceBlobUrl 和 sourcePathname 都存在的情况下仍然返回 upload_not_finalized 的错误。

根本原因：代码使用 `job.sourcePdfPath || job.sourceBlobUrl` 判断上传是否完成，但实际存储的是 `sourceBlobUrl` 和 `sourcePathname`，没有 `sourcePdfPath` 字段。

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| lib/jobs/service.ts | modify | analyzeJobV1 改用 `sourceBlobUrl && sourcePathname` 判断上传是否完成；添加失败的错误处理；processJob 同样修复 |
| lib/jobs/repository.ts | modify | getSourcePdfForProcessing 改用 `sourceBlobUrl && sourcePathname` 判断；先读取 job 再检查字段 |
| app/api/jobs/[jobId]/analyze/route.ts | modify | upload_not_finalized 错误返回添加诊断字段 |
| app/api/jobs/[jobId]/process/route.ts | modify | upload_not_finalized 错误返回添加诊断字段 |

## 关键实现说明

### 1. 统一的上传完成判断

```typescript
// 正确的判断方式
const hasFinalizedUpload = Boolean(job.sourceBlobUrl) && Boolean(job.sourcePathname);
if (!hasFinalizedUpload) {
  throw new UploadNotFinalizedError(jobId);
}
```

不再使用以下错误判断：
- `!job.sourcePdfPath && !job.sourceBlobUrl`（sourcePdfPath 字段不存在）
- `job.status !== "uploaded"`（status 已变为 analyzing）

### 2. analyzeJobV1 修复

修复前：
```typescript
await transitionJobStatus(jobId, "analyzing");  // 先改状态
const job = await readJob(jobId);
// 此时 status 已经是 analyzing，不是 uploaded
if (!job.sourcePdfPath && !job.sourceBlobUrl) {  // sourcePdfPath 不存在
  throw new UploadNotFinalizedError(jobId);  // 错误抛出
}
```

修复后：
```typescript
const job = await readJob(jobId);
const hasFinalizedUpload = Boolean(job.sourceBlobUrl) && Boolean(job.sourcePathname);
if (!hasFinalizedUpload) {
  throw new UploadNotFinalizedError(jobId);
}
await transitionJobStatus(jobId, "analyzing");  // 检查通过后再改状态
```

### 3. 诊断字段

如果仍然返回 upload_not_finalized，响应现在包含：

```typescript
{
  success: false,
  code: "upload_not_finalized",
  message: "Upload not finalized for job: ...",
  jobId,
  status: job.status,
  hasSourceBlobUrl: Boolean(job.sourceBlobUrl),
  hasSourcePathname: Boolean(job.sourcePathname),
  sourcePathname: job.sourcePathname || null
}
```

### 4. 错误处理改进

analyzeJobV1 的 catch 块现在会：
- 确保 job 被标记为 failed 状态
- 避免覆盖已经设置的特定错误码
- 重新抛出错误让上层处理

```typescript
catch (error) {
  const errorMessage = error instanceof Error ? error.message : "Analysis failed";
  const currentJob = await readJob(jobId);
  if (currentJob.status !== "failed") {
    await transitionJobStatus(jobId, "failed", {
      code: "analysis_failed",
      message: errorMessage,
    });
  }
  throw error;
}
```

## 测试命令

```bash
pnpm lint
pnpm build
```

## 测试结果

| 测试项 | 结果 |
|--------|------|
| pnpm lint | ✅ pass (1 warning: getSourcePdfUrl 未使用) |
| pnpm build | ✅ pass |
| TypeScript 类型检查 | ✅ pass |

## 部署后验证步骤

1. 部署到 Vercel Preview
2. 上传新的 0.43MB PDF（不要复用旧 job）
3. 验证 Network 顺序：
   - POST /api/jobs/create → 200
   - POST /api/jobs/upload-token → 200
   - POST /api/jobs/upload-token (multipart) → 200/201
   - POST /api/jobs/{jobId}/finalize-upload → 200
   - POST /api/jobs/{jobId}/analyze → 200（不应再返回 409）
   - POST /api/jobs/{jobId}/process → 200

4. 如果 analyze 仍返回 409，检查响应中的诊断字段：
   - hasSourceBlobUrl 应该为 true
   - hasSourcePathname 应该为 true
   - sourcePathname 应该存在

## SOP 候选规则

1. **Blob 存储上传完成判断**：使用 `sourceBlobUrl && sourcePathname` 判断上传是否完成，不依赖 job.status 字符串。

2. **错误诊断字段**：关键错误（如 upload_not_finalized）应返回诊断字段帮助定位问题，包括相关字段的存在性检查结果。

3. **状态流转顺序**：先验证条件，再更新状态。避免在状态更新后才读取 job 进行验证。

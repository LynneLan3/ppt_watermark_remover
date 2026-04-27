# 2026-04-27 修复 Blob pathname 冲突和重复上传问题

## 任务目标
修复 Vercel Preview 环境中出现的两个问题：
1. Blob pathname 冲突（"This blob already exists" 500 错误）
2. 前端重复调用 upload-token

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| lib/blob-storage/job-store.ts | modify | writeJob 和 saveSourcePdf 添加 `allowOverwrite: true` |
| lib/jobs/repository.ts | modify | persistAnalyzeOutputs 和 persistProcessOutput 中的 put 添加 `allowOverwrite: true` |
| components/tool/upload-hero.tsx | modify | 添加 uploadingRef 锁；改进错误消息清理；完善 handleRetry 和 handleProcessAnother 状态重置 |
| app/api/jobs/upload-token/route.ts | modify | 捕获 Blob already exists 错误；错误消息脱敏 |
| lib/jobs/types.ts | modify | 添加 `blob_path_conflict` 错误码 |
| lib/jobs/api.ts | modify | 添加 blob_path_conflict 错误映射 |

## 关键实现说明

### 1. Blob pathname 冲突修复

所有 `@vercel/blob` 的 `put` 调用都添加了 `allowOverwrite: true`：

```typescript
// lib/blob-storage/job-store.ts
await put(pathname, JSON.stringify(job, null, 2), {
  contentType: "application/json",
  access: "private",
  allowOverwrite: true,  // 允许覆盖
});
```

### 2. 前端重复上传锁

添加 `uploadingRef` 防止同一文件多次进入上传流程：

```typescript
const uploadingRef = useRef(false);

const handleSelectFile = (list: FileList | null) => {
  if (uploadingRef.current) return;  // 防止重复
  uploadingRef.current = true;
  // ...
  void runProcessingPipeline(file, runId).finally(() => {
    uploadingRef.current = false;
  });
};
```

### 3. Try again 状态重置

handleRetry 现在正确重置所有状态：

```typescript
const handleRetry = () => {
  resetJobState();
  setErrorMessage(null);
  setProcessedPdfUrl(null);
  setProcessedPreviewReady(false);
  // ...
};
```

### 4. 错误消息脱敏

前端和后端都添加错误消息清理，不暴露内部技术细节：

```typescript
function sanitizeErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const lower = message.toLowerCase();
  if (lower.includes("blob already exists") || lower.includes("vercel.blob")) {
    return "Upload was retried with the same temporary file path. Please try again.";
  }
  return message;
}
```

### 5. 结构化错误返回

upload-token route 返回结构化错误：

```typescript
if (lowerError.includes("blob already exists")) {
  return jobError({
    httpStatus: 409,
    code: "blob_path_conflict",
    message: "Temporary upload path already exists. Please try again.",
  });
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
| pnpm lint | ✅ pass |
| pnpm build | ✅ pass |
| TypeScript 类型检查 | ✅ pass |

## 未解决问题

无

## 下一步建议

1. 重新部署到 Vercel Preview
2. 上传同一个 0.43MB PDF 验证：
   - upload-token 不再返回 500
   - upload-token 只触发一次
   - 完整流程：create → upload-token → analyze → process → download

## SOP 候选规则

1. **Vercel Blob 覆盖策略**：所有 `put` 调用必须明确设置 `allowOverwrite` 或 `addRandomSuffix`，避免 pathname 冲突。

2. **前端上传锁**：文件上传流程必须使用 `uploadingRef` 锁防止重复提交，特别是拖放和点击选择可能同时触发的情况。

3. **错误消息脱敏**：所有 API 错误返回给前端前必须经过脱敏处理，移除内部路径、token、第三方服务详情等技术信息。

4. **状态重置完整性**："Try again" 和 "Upload another" 操作必须完整重置所有相关状态（job、file、error、preview、blob references）。

# 2026-04-27 修复 source PDF 读取和错误码映射

## 问题背景

analyze API 在 job manifest 存在、sourceBlobUrl 和 sourcePathname 都存在的情况下，仍然返回 `job_not_found`。这是因为：

1. 之前的代码尝试直接 fetch private blob URL（不带认证）
2. 读取失败后被错误地映射为 `job_not_found`
3. 没有区分 "job 不存在"、"source PDF 不存在"、"source PDF 读取失败" 等不同错误

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| lib/blob-storage/job-store.ts | modify | 添加 `sourcePdfExists()` 检查；添加 `SourcePdfNotFoundError` 和 `SourcePdfReadFailedError` 错误类型；`getSourcePdfBuffer` 抛出具体错误而非返回 null |
| lib/jobs/repository.ts | modify | 导出新的错误类型和 `sourcePdfExists`；更新 `getSourcePdfForProcessing` 使用新的错误类型 |
| lib/jobs/types.ts | modify | 添加 `source_pdf_not_found` 和 `source_pdf_read_failed` 错误码 |
| lib/jobs/service.ts | modify | `analyzeJobV1` 正确处理新的错误类型；移除 buffer null 检查（因为函数现在直接抛出错误） |
| app/api/jobs/[jobId]/analyze/route.ts | modify | 添加 `SourcePdfNotFoundError` 和 `SourcePdfReadFailedError` 的错误处理映射 |
| app/api/jobs/[jobId]/debug/route.ts | modify | 添加 `sourcePdfExists` 检查和更多诊断字段 |

## 关键实现说明

### 1. 新的错误类型

```typescript
// lib/blob-storage/job-store.ts
export class SourcePdfNotFoundError extends Error {
  readonly jobId: string;
  readonly pathname: string;
  constructor(jobId: string, pathname: string) {
    super(`Source PDF not found: ${pathname}`);
    this.name = "SourcePdfNotFoundError";
    this.jobId = jobId;
    this.pathname = pathname;
  }
}

export class SourcePdfReadFailedError extends Error {
  readonly jobId: string;
  readonly pathname: string;
  readonly cause: Error | undefined;
  constructor(jobId: string, pathname: string, cause?: Error) {
    super(`Failed to read source PDF: ${pathname}${cause ? ` - ${cause.message}` : ""}`);
    this.name = "SourcePdfReadFailedError";
    this.jobId = jobId;
    this.pathname = pathname;
    this.cause = cause;
  }
}
```

### 2. 正确的 private Blob 读取

```typescript
// lib/blob-storage/job-store.ts
export async function getSourcePdfBuffer(jobId: string): Promise<Buffer> {
  const pathname = getSourcePdfPathname(jobId);
  try {
    // 使用 @vercel/blob SDK 的 get() 方法，而不是裸 fetch
    const response = await get(pathname, { access: "private" });
    if (!response) {
      throw new SourcePdfNotFoundError(jobId, pathname);
    }
    if (response.statusCode !== 200) {
      throw new SourcePdfReadFailedError(jobId, pathname, new Error(`HTTP ${response.statusCode}`));
    }
    // ... 读取 stream
  } catch (error) {
    // 分类错误并抛出具体类型
    if (error instanceof SourcePdfNotFoundError || error instanceof SourcePdfReadFailedError) {
      throw error;
    }
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes("not found") || message.includes("blob not found")) {
        throw new SourcePdfNotFoundError(jobId, pathname);
      }
      throw new SourcePdfReadFailedError(jobId, pathname, error);
    }
    throw new SourcePdfReadFailedError(jobId, pathname, new Error("Unknown error"));
  }
}
```

### 3. analyze 错误码映射

```typescript
// app/api/jobs/[jobId]/analyze/route.ts
if (error instanceof JobNotFoundError) {
  // 只有 job 真正不存在时才返回 404 job_not_found
  return Response.json({ code: "job_not_found", ... }, { status: 404 });
}

if (error instanceof UploadNotFinalizedError) {
  // source 元数据缺失时返回 409 upload_not_finalized
  return jobError({ httpStatus: 409, code: "upload_not_finalized", ... });
}

if (error instanceof SourcePdfNotFoundError) {
  // source pathname 存在但 blob 不存在时返回 404 source_pdf_not_found
  return Response.json({ code: "source_pdf_not_found", ... }, { status: 404 });
}

if (error instanceof SourcePdfReadFailedError) {
  // 读取失败时返回 500 source_pdf_read_failed
  return Response.json({ code: "source_pdf_read_failed", ... }, { status: 500 });
}
```

### 4. debug endpoint 增强

```typescript
// app/api/jobs/[jobId]/debug/route.ts
const sourcePdfExistsResult = hasSourcePathname ? await sourcePdfExists(jobId) : false;

return NextResponse.json({
  ok: true,
  jobId,
  storageBackend: diagnostics.storageBackend,
  hasBlobToken: diagnostics.hasBlobToken,
  expectedManifestPath: diagnostics.expectedManifestPath,
  jobManifestExists: true,
  sourcePdfExists: sourcePdfExistsResult,  // 新增
  status: job.status,
  errorCode: job.failureCode || null,  // 新增
  errorMessage: job.failureMessage || null,  // 新增
  hasSourceBlobUrl: !!job.sourceBlobUrl,
  hasSourcePathname: hasSourcePathname,
  sourcePathname: job.sourcePathname || null,
  // ...
});
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

## 部署后验证步骤

1. 部署到 Vercel Preview
2. 上传新的 0.43MB PDF（不要复用旧 job）
3. 验证 Network 顺序：
   - POST /api/jobs/create → 200
   - POST /api/jobs/upload-token → 200
   - POST /api/jobs/upload-source → 200
   - POST /api/jobs/{jobId}/finalize-upload → 200
   - GET /api/jobs/{jobId}/debug → 检查 `sourcePdfExists: true`
   - POST /api/jobs/{jobId}/analyze → **不应再返回 job_not_found**

4. 如果 analyze 失败，检查错误码：
   - `source_pdf_not_found` - source pathname 存在但实际 blob 不存在
   - `source_pdf_read_failed` - 读取 blob 时出错（权限、网络等）
   - `analysis_failed` - Python analyze 执行失败

## SOP 候选规则

1. **Private Blob 读取必须使用 SDK**：使用 `@vercel/blob` 的 `get()`、`head()` 等方法，不要直接 `fetch` private blob URL。

2. **错误码精确映射**：
   - `job_not_found` - 仅用于 job manifest 不存在
   - `upload_not_finalized` - source 元数据字段缺失
   - `source_pdf_not_found` - source blob 不存在
   - `source_pdf_read_failed` - 读取 source blob 失败
   - `analysis_failed` - 分析执行失败

3. **debug endpoint 必须暴露诊断信息**：包括 storage backend、token 状态、manifest 存在性、source PDF 存在性、当前 status、error code/message 等。

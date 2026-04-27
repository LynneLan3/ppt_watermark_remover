# 2026-04-27 添加 finalize-upload 路由修复 analyze 409 错误

## 任务目标

修复 Vercel Preview 环境中 analyze API 返回 409 CONFLICT 错误的问题。根本原因是 blob 上传成功后，sourceBlobUrl 和 sourcePathname 没有被写入 job manifest，导致 analyze 无法找到上传的文件。

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| app/api/jobs/[jobId]/finalize-upload/route.ts | create | 新的 finalize-upload API 路由，将 blob URL 和 pathname 写入 job manifest |
| app/api/jobs/[jobId]/debug/route.ts | create | 调试路由，返回 job 状态、hasSourceBlobUrl、hasSourcePathname 等信息 |
| components/tool/upload-hero.tsx | modify | 添加上传锁防止重复调用；增加 6 步处理流程可视化；调用 finalize-upload 后再调用 analyze |
| lib/jobs/types.ts | modify | 添加 upload_not_finalized 错误码 |

## 关键实现说明

### 1. finalize-upload 路由

```typescript
// app/api/jobs/[jobId]/finalize-upload/route.ts
export async function POST(request: Request, { params }: Params) {
  // 从请求体获取 sourceBlobUrl, sourcePathname, fileName, size, contentType
  // 更新 job manifest，设置 status 为 "uploaded"
  // 返回 hasSourceBlobUrl, hasSourcePathname 标志
}
```

关键逻辑：
- 读取现有 job 记录
- 验证 sourceBlobUrl 和 sourcePathname 必须存在
- 更新 job 的 sourceBlobUrl, sourcePathname, sourceFilename, sourceSize, sourceContentType
- 设置 status 为 "uploaded"
- 写入更新后的 job manifest

### 2. debug 路由

用于诊断问题，返回：
- ok: boolean
- jobId, status
- hasSourceBlobUrl, hasSourcePathname
- sourceBlobUrl (截断), sourcePathname, sourceFilename
- sourceSize, sourceContentType, createdAt, updatedAt, expiresAt

### 3. 前端 6 步处理流程

```typescript
type ProcessingStep = {
  name: string;
  status: "pending" | "running" | "ok" | "failed";
  message?: string;
};

const processingSteps = [
  { name: "create job", status: "pending" },
  { name: "blob upload", status: "pending" },
  { name: "finalize upload", status: "pending" },
  { name: "analyze", status: "pending" },
  { name: "process", status: "pending" },
];
```

流程顺序：
1. create job (POST /api/jobs/create)
2. get upload token (POST /api/jobs/upload-token)
3. blob upload (POST /api/jobs/upload-token with multipart)
4. **finalize upload** (POST /api/jobs/{jobId}/finalize-upload) ← 新增关键步骤
5. analyze (POST /api/jobs/{jobId}/analyze)
6. process (POST /api/jobs/{jobId}/process)

### 4. 上传锁防止重复

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

### 5. 错误消息脱敏

```typescript
function sanitizeErrorMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const lower = message.toLowerCase();
  if (lower.includes("blob already exists") || lower.includes("vercel.blob")) {
    return "Upload was retried with the same temporary file path. Please try again.";
  }
  // Remove internal paths
  if (message.includes("jobs/") || message.includes("/tmp/")) {
    return "Processing failed. Please try again or use a different PDF.";
  }
  return message;
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
| 新路由可见性 | ✅ finalize-upload, debug 路由在 build 输出中 |

## 未解决问题

无

## 下一步建议

1. 部署到 Vercel Preview 环境
2. 使用 0.43MB PDF 测试完整流程：
   - Network 顺序验证：create 200 → upload-token 200 → Blob upload 200/201 → finalize-upload 200 → analyze 200 → process 200
   - 如果 analyze 仍返回 409，检查 GET /api/jobs/{jobId}/debug 确认 hasSourceBlobUrl 和 hasSourcePathname 为 true

## SOP 候选规则

1. **Vercel Blob 上传后必须 finalize**：使用 Vercel Blob 存储时，上传完成后必须有明确的 finalize 步骤将 blob 元数据持久化到 job manifest，避免跨请求状态丢失。

2. **前端上传流程加锁**：文件选择和拖放事件可能重复触发，必须使用 useRef 锁防止同一文件多次进入上传流程。

3. **API 调用可视化**：复杂多步骤流程应该提供步骤可视化（step indicator），方便用户理解当前进度和调试问题。

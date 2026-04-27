# 修复上线阻断问题

## 任务目标
修复当前项目的上线阻断问题，确保版本可以稳定部署，线上主流程可用：首页上传 PDF -> 自动处理 -> loading -> before/after 预览 -> 下载 cleaned PDF。

## 修改文件列表

| 文件路径 | 修改类型 | 说明 |
|----------|----------|------|
| app/layout.tsx | modify | 移除 next/font/google 字体依赖，修复离线构建失败 |
| lib/server/temp-storage/paths.ts | modify | 使用 os.tmpdir() 替代 process.cwd()，修复 Vercel 临时目录不可写 |
| lib/storage/job-paths.ts | modify | 使用 os.tmpdir() 替代 process.cwd()，修复 Vercel 临时目录不可写 |

## 每个文件修改说明

### app/layout.tsx

**修改原因**：`next/font/google` 在构建时需要联网下载 Google Font，离线环境构建会失败。

**修改前**：
```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

<html
  lang="zh-CN"
  suppressHydrationWarning
  className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
>
```

**修改后**：
```tsx
<html
  lang="zh-CN"
  suppressHydrationWarning
  className="h-full antialiased"
>
```

### lib/server/temp-storage/paths.ts

**修改原因**：Vercel 运行时的 `/var/task` 目录是只读的，`process.cwd()` 返回的就是这个路径。临时文件必须写入 `/tmp` 目录。

**修改前**：
```ts
export function getTempJobsRoot(): string {
  return path.join(process.cwd(), "temp", "jobs");
}
```

**修改后**：
```ts
import os from "node:os";

export function getTempJobsRoot(): string {
  return path.join(os.tmpdir(), "notebooklm-remover", "jobs");
}
```

### lib/storage/job-paths.ts

**修改原因**：同上，新的 jobs API 使用的路径也需要修复。

**修改前**：
```ts
export function getJobsRoot(): string {
  return path.join(process.cwd(), "temp", "jobs-v2");
}
```

**修改后**：
```ts
import os from "node:os";

export function getJobsRoot(): string {
  return path.join(os.tmpdir(), "notebooklm-remover", "jobs-v2");
}
```

## 测试命令

```bash
pnpm lint
pnpm build
```

## 测试结果

| 检查项 | 结果 |
|--------|------|
| `pnpm lint` | ✅ Pass |
| `pnpm build` | ✅ Pass（含 Turbopack warnings） |

Turbopack warnings 是关于 manual-review 服务的动态路径匹配，不影响主流程部署。

## 未解决问题

1. Turbopack tracing warnings（不影响上线，仅性能提示）
2. manual-review 服务的路径也使用了 process.cwd()，但不在本次修复范围内（用户明确排除）

## 下一步建议

1. 部署到 Vercel Preview 环境验证完整主流程
2. 监控 `/tmp` 目录空间使用情况（Vercel 有 512MB 限制）
3. 考虑添加临时文件清理机制，防止 /tmp 空间耗尽

## SOP 候选规则

1. **Vercel 部署时临时目录必须使用 os.tmpdir()**：
   - 不要在 Vercel 上写入 process.cwd() 或 __dirname 下的文件
   - 所有临时上传、处理、缓存文件都应放在 os.tmpdir() 下

2. **避免构建时外部网络依赖**：
   - 不要在 layout 中使用 next/font/google
   - 如需字体，使用本地字体文件或系统字体栈

# 2026-04-27 Analyze 阶段化诊断与 Preview Fallback

## 任务目标

在不再改 upload/job/blob 链路的前提下，修复 analyze 内部失败不可观测问题，并让 Preview 在 Python 运行时不完整时仍可走通主链路（analyze/process/preview/download）。

## 修改文件列表

| 文件路径 | 类型 | 说明 |
|---------|------|------|
| app/api/jobs/[jobId]/analyze/route.ts | modify | analyze 失败按 phase/code 返回，附 runtime/error 诊断字段 |
| lib/jobs/service.ts | modify | analyze 阶段化执行、python runtime/script/dependency 检查、JS fallback；process passthrough-fallback |
| lib/jobs/js-analyze-fallback.ts | create | 纯 JS analyze fallback（页数 + 最小 analysis） |
| app/api/jobs/[jobId]/process/route.ts | modify | process stateless 返回 processMode/warning，兼容 passthrough-fallback |
| components/tool/upload-hero.tsx | modify | processing steps 展示 analyze 阶段细节和失败 phase/code |
| lib/jobs/types.ts | modify | 增加 analyze 分阶段错误码 |
| scripts/debug-analyze.mjs | create | 本地 debug analyze 脚本 |
| package.json | modify | 新增 `pnpm analyze:debug -- <path-to-pdf>` |
| .ai/project-state.md | modify | 同步项目状态 |

## 每个文件修改说明

### 1) analyze route 阶段化与结构化错误返回

修改前：
- analyze 失败常见返回 `code: analyze_failed`，缺少具体阶段和运行时信息。

修改后：
- 失败响应包含：
  - `code`
  - `phase`
  - `jobId`
  - `sourcePathname`
  - `hasBodySourcePathname`
  - `hasBodySourceBlobUrl`
  - `jobManifestExists`
  - `sourcePdfExists`
  - `pdfBufferBytes`
  - `runtime`（nodeEnv/vercel/vercelEnv/cwd）
  - `error`（name/message/exitCode/signal/stderrPreview/stdoutPreview，preview/debug 模式展开）

### 2) analyze service 拆分执行阶段

新增阶段并记录 trace：
1. `resolve_source_input`
2. `read_source_pdf_from_blob`
3. `validate_pdf_buffer`
4. `run_pdf_analyzer`
5. `parse_analyzer_output`
6. `write_analysis_result`
7. `patch_job_ready_for_review`

新增精确错误码：
- `source_pdf_not_found`
- `source_pdf_read_failed`
- `pdf_buffer_empty`
- `pdf_analyzer_runtime_missing`
- `pdf_analyzer_script_missing`
- `pdf_analyzer_dependency_missing`
- `pdf_analyzer_failed`
- `pdf_analyzer_output_invalid`
- `analysis_write_failed`
- `analyze_failed`

### 3) Python 运行时兼容检查

analyze 在 `run_pdf_analyzer` 阶段新增：
- Python runtime 检查（`python3 --version` / `python --version`）
- 脚本存在性检查（`engine/python/cli.py` / `python/extract_page_commands.py`）
- 依赖检查（`import pikepdf; import fitz`）

错误不再被统一吞并成 `analyze_failed`。

### 4) JS analyze fallback（Preview）

新增 `lib/jobs/js-analyze-fallback.ts`：
- 使用 `pdf-lib` 读取页数
- 输出最小 analysis（`analyzer: js-fallback`、`pageCount`、`recommendedProcessMode`、每页 hint）

当 Preview/Debug 环境遇到：
- `pdf_analyzer_runtime_missing`
- `pdf_analyzer_script_missing`
- `pdf_analyzer_dependency_missing`

自动 fallback 到 JS analyzer，analyze 返回 200。

### 5) process passthrough fallback（Preview）

`processJobStateless` 中：
- Python process 失败且判定为 runtime/dependency 类问题时
- 在 Preview/Debug 环境自动 fallback：直接写入原始 PDF 为 `processed.pdf`
- 返回 `processMode: passthrough-fallback`
- 返回 warning：`Python processor unavailable in preview; returned original PDF.`

### 6) 前端步骤可视化增强

`components/tool/upload-hero.tsx` 更新：
- analyze 成功时显示阶段信息与 analyzer 选择
- analyze 失败时显示 `phase + code + message`

### 7) 本地复现脚本

新增：
```bash
pnpm analyze:debug -- ./sample.pdf
```

输出：
- `pdfBufferBytes`
- `selectedAnalyzer`
- `pythonAvailable`
- `scriptExists`
- `dependencyCheck`
- 基础 analysis 结果

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

1. 仍需在 Preview 实际上传 0.43MB PDF 验证 analyze 是否触发 JS fallback / process 是否触发 passthrough-fallback。
2. Python 真正部署依赖（PyMuPDF/OpenCV/pikepdf）仍需后续阶段完善，不在本次范围内。

## 下一步建议

1. Preview 上传 0.43MB PDF，确认 analyze 失败不再是裸 `analyze_failed`。
2. 若 Python 环境缺失，确认 analyze 返回 200 且 `analyzer: js-fallback`。
3. 确认 process 返回 200（必要时 `processMode: passthrough-fallback`），并可 preview/download。

## SOP 候选规则

1. 服务端 analyze 失败必须返回 phase+code+runtime+stderr/stdout 预览，避免仅返回泛化错误。
2. Preview 环境允许算法能力降级（JS analyze / passthrough process）以优先验证主链路可用性。
3. Python 依赖类错误需显式区分 runtime/script/dependency，禁止统一映射为 `analyze_failed`。

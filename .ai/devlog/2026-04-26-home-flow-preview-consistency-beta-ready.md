# Devlog

> 日期：2026-04-26
> 任务：首页主流程与预览一致性修复（Beta 手测可用）

---

## 任务目标

在不继续算法优化的前提下，完成首页首屏工具化改造、处理状态机落地、全屏 processing 覆盖层，以及左右预览页码/页数一致性修复。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| components/tool/upload-hero.tsx | modify | 重构首页首屏主流程：大上传卡、显式状态机、全屏 loading、共享页码预览、下载门控 |
| components/tool/pdf-single-page-preview.tsx | modify | 增加 strict page match 和缺页占位，避免右侧预览自动跳页 |
| .ai/project-state.md | modify | 更新当前工作项、关键指标和最近修改记录 |
| .ai/sop-candidates.md | modify | 记录本轮可复用规则候选（shared page + 下载门控三条件） |
| .ai/devlog/2026-04-26-home-flow-preview-consistency-beta-ready.md | create | 记录本轮改动、测试结果、风险和 SOP 候选 |

---

## 每个文件修改说明

### 文件 1: `components/tool/upload-hero.tsx`

**修改前**:
```tsx
// 上传与处理是一个按钮（Upload and process）
// 页面局部 loading，非全屏遮罩
// 预览区始终渲染，右侧页数与左侧可出现不一致
```

**修改后**:
```tsx
type WorkflowState = "idle" | "uploaded" | "processing" | "ready_for_preview" | "ready_for_download" | "failed";

// 首屏大上传卡 + 文件信息卡 + Replace file + 大 CTA(Remove watermark)
// processing 时固定全屏 overlay，阶段文案：uploading/analyzing/removing/preparing
// 预览使用 shared currentPage/shared totalPages
// Download 仅在 ready_for_download + cleanedPdfUrl + preview ready 可点
```

**原因**:
满足 Beta 手测需求，避免用户在处理中误操作，并消除左右预览不同步和下载过早可点的问题。

### 文件 2: `components/tool/pdf-single-page-preview.tsx`

**修改前**:
```tsx
const targetPage = Math.min(Math.max(page, 1), doc.numPages);
// 请求超页会自动回退到最后一页，导致“右侧页码/内容错位”
```

**修改后**:
```tsx
if (strictPageMatch && page > doc.numPages) {
  setIsPageUnavailable(true);
  // 显示占位文案，不再跳到其它页
}
```

**原因**:
保证左右预览对同一页号进行比较；当 cleaned PDF 对应页不存在时，明确展示 unavailable 占位而非错误页内容。

### 文件 3: `.ai/project-state.md`

**修改前**:
```md
最后更新：2026-04-25 ...
```

**修改后**:
```md
最后更新：2026-04-26 09:44 CST
- 新增本轮前端状态机/overlay/预览同步修复记录
- 关键指标更新为 lint pass、build 受 fonts 网络环境阻塞
```

**原因**:
满足项目事实记录要求，保证当前状态可追溯。

---

## 测试命令

```bash
pnpm lint
pnpm build
```

---

## 测试结果

- `pnpm lint`: **pass**
- `pnpm build`: **fail**
  - 原因：`next/font` 拉取 Google Fonts 失败（`Geist` / `Geist Mono`），报错为网络获取失败。
  - 结论：本轮改动未引入新的类型/语法错误，构建失败来自环境网络依赖。

---

## 未解决问题

1. 后端 `python/process_raster_watermark_v1.py` 当前仅将 `result.success` 的页面写入输出 PDF，存在输出页数少于原始页数的风险。
2. `pnpm build` 受当前环境无法拉取 Google Fonts 影响，需在可联网环境或本地字体回退方案下复验。

---

## 下一步建议

1. 修复后端输出 PDF 页数保持策略（保证与输入页数一致，失败页采用原页直拷或显式失败策略）。
2. 在 Vercel Preview 环境进行 3-5 份真实样本手测（重点验证 shared page 和缺页占位）。
3. 若需离线构建稳定，可将 `next/font/google` 改为本地字体方案或提供 fallback。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 双栏 PDF 预览必须由 shared currentPage/shared totalPages 驱动，单侧缺页只允许显示 placeholder，禁止自动跳页 | 本轮首页预览一致性修复 | 1 | 暂不升级（需在更多样本复验） |
| 下载按钮应绑定“后端 ready + cleaned url 存在 + cleaned preview 可渲染”三条件 | 本轮下载门控补强 | 1 | 暂不升级（需线上反馈复验） |

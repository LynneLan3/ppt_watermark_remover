# Devlog

> 日期：2026-04-26
> 任务：前端页面收口（移除默认 feedback、示例图区替换、首页上传锚点跳转）

---

## 任务目标

不做算法改动，仅完成正式用户页面收口：默认不展示 Page feedback、示例区改为 before/after 双图、并将 Start from homepage upload 精确跳转到首页上传主卡。

---

## 修改文件列表

| 文件路径 | 修改类型 | 简要说明 |
|----------|----------|----------|
| components/tool/upload-hero.tsx | modify | 默认用户路径隐藏 Page feedback；仅 debug/internal 显示；新增 `id=homepage-upload` 与 hash 平滑滚动 |
| components/tool/preview-showcase.tsx | modify | 用真实图片替换占位示例，改为 before/after 双图对比布局 |
| content/pages/home-tool.ts | modify | 将 `Start from homepage upload` 的 href 改为 `/#homepage-upload`，标签改为 Before cleanup/After cleanup |
| public/images/home-before-cleanup.jpg | create | 首页 Before cleanup 示例图 |
| public/images/home-after-cleanup.jpg | create | 首页 After cleanup 示例图 |
| .ai/project-state.md | modify | 更新项目状态与最近修改 |
| .ai/sop-candidates.md | modify | 追加本轮 SOP 候选 |
| .ai/devlog/2026-04-26-frontend-closure-preview-and-anchor.md | create | 记录本轮改动与测试 |

---

## 每个文件修改说明

### 文件 1: `components/tool/upload-hero.tsx`

**修改前**:
```tsx
// showPreview 后始终渲染 Page feedback 区块
```

**修改后**:
```tsx
const isInternalReviewVisible =
  process.env.NEXT_PUBLIC_ENABLE_INTERNAL_REVIEW === "true" || debugQueryEnabled;

{isInternalReviewVisible ? <PageFeedbackBlock /> : null}
```

并在上传主卡增加：
```tsx
<div id="homepage-upload" ...>
```

以及 hash 平滑滚动对齐逻辑。

**原因**:
满足“正式用户路径不显示 feedback、保留内部调试入口、上传锚点精确落位”的要求。

### 文件 2: `components/tool/preview-showcase.tsx`

**修改前**:
```tsx
<div className="... border-dashed ..." /> // 占位块
```

**修改后**:
```tsx
<Image src="/images/home-before-cleanup.jpg" ... />
<Image src="/images/home-after-cleanup.jpg" ... />
```

并保持统一圆角/边框，桌面双栏、移动端堆叠。

**原因**:
替换为真实 before/after 示例，避免单图或占位图误导。

### 文件 3: `content/pages/home-tool.ts`

**修改前**:
```ts
primaryCta.href = "/"
beforeCardTitle = "Before"
afterCardTitle = "After"
```

**修改后**:
```ts
primaryCta.href = "/#homepage-upload"
beforeCardTitle = "Before cleanup"
afterCardTitle = "After cleanup"
```

**原因**:
确保按钮点击后直接落到首页上传主卡，并与示例图区标签一致。

---

## 测试命令

```bash
pnpm lint
pnpm build
```

---

## 测试结果

- `pnpm lint`: **pass**
- `pnpm build`: **pass**（存在 Turbopack tracing warnings，不阻塞）

---

## 未解决问题

1. `next build` 仍有 Turbopack tracing warnings（动态路径扫描范围较大）。

---

## 下一步建议

1. 在浏览器手测 `/#homepage-upload` 的跨页跳转与同页点击滚动体验。
2. 若需长期维护内部 QA 入口，可将 debug gate 统一抽为一个共享 hook。

---

## SOP 候选规则

| 规则 | 来源 | 验证次数 | 建议 |
|------|------|----------|------|
| 正式用户路径默认不展示 Page feedback；仅在 debug/internal 开关下显示 | 本轮页面收口 | 1 | 暂不升级 |
| 首页 CTA 指向上传入口必须使用稳定锚点（如 `/#homepage-upload`）避免回到页面顶部 | 本轮锚点跳转修复 | 1 | 暂不升级 |

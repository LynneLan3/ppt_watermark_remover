# AGENTS.md

## Project
This repository is for NotebookLM Watermark Remover, a productized PDF-first NotebookLM cleanup tool with supporting marketing and SEO pages.

## Current Stage
Stage 2 Beta: NotebookLM PDF cleanup workflow with temporary Blob-backed storage and server-side processing.

### Core Workflow (Active)
- NotebookLM PDF temporary upload
- Blob-backed job manifest (`jobs/{jobId}/job.json`)
- Server-side analyze (detect watermark candidates)
- Server-side process (remove supported watermarks)
- Preview cleaned result (before/after comparison)
- Download cleaned PDF
- Auto delete/expire temporary files after download or TTL

### Currently Allowed
- Upload backend API (`/api/jobs/*` routes)
- Vercel Blob storage pipeline (job metadata + source PDFs)
- Server/client cleanup workflow
- Temporary processing with short retention
- Preview confirmation UI
- Download cleaned artifacts
- Automatic/manual job deletion

### Explicitly Out of Scope (Do Not Add)
- User authentication / auth system
- Billing / pricing / payment
- User dashboard / account management
- Database-backed user account system
- Blog / CMS
- Analytics integrations
- Permanent document archive
- Queue infrastructure (not needed for current scale)
- PPTX upload/cleanup (PDF-first only)
- Admin area (no multi-user management needed)

## Current Goals
Build:
- temporary upload with short-lived retention
- auto delete after download or short expiry
- real upload -> analysis -> preview -> confirm -> download workflow
- PDF-first cleanup support for NotebookLM exports
- explicit supported-vs-unsupported object-level cleanup behavior
- legal/trust copy aligned with temporary retention and deletion
- marketing pages and SEO pages aligned with actual product behavior

## Required Stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- MDX
- pnpm
- Vercel deployment target

## Content Rules
- Long-form copy must live in content files, not hardcoded inside UI components.
- Reusable sections should be extracted into components.
- Each indexable page must define metadata.
- Keep copy easy to edit and SEO-friendly.

## UI Rules
- Clean SaaS style
- Light background by default
- Minimal animation
- Mobile-first
- Clear CTA sections
- Prioritize readability and trust

## Engineering Rules
- Prefer server components unless client components are necessary.
- Do not add new production dependencies without clear justification.
- Keep the repository simple and easy to maintain.
- Avoid premature abstractions.
- Run lint and build before marking work complete.

## Temporary Processing Rules
- Uploaded files are temporary only, not permanent user storage.
- Store per-job artifacts under temporary job folders.
- Delete files after download or short expiry.
- Do not log raw document contents.
- Do not claim universal cleanup success; fail safely for unsupported structures.

## Blob-Backed Job Storage (Vercel Production)
- Job metadata is stored in Vercel Blob at `jobs/{jobId}/job.json`.
- Source PDFs are stored at `jobs/{jobId}/source.pdf`.
- Analysis artifacts are stored alongside job metadata in Blob storage.
- Processed outputs are uploaded to Blob after Python processing completes.
- Local filesystem is used for temporary Python processing files only.
- Blob storage requires `BLOB_READ_WRITE_TOKEN` environment variable.
- When `BLOB_READ_WRITE_TOKEN` is not set, system falls back to local filesystem (development mode).

## Project Fact Recording Rules (MUST FOLLOW)

> These rules ensure project facts are properly recorded for SOP evolution.

### 1. project-state.md Updates
After every AI code modification, you MUST update `.ai/project-state.md`:
- Add the modified file to "最近修改" table
- Update "当前工作项" status
- Update "关键指标" if test results changed

### 2. devlog Creation
After completing a clear task, you MUST create or update `.ai/devlog/YYYY-MM-DD-task-name.md`:
- **任务目标**: One sentence description
- **修改文件列表**: File path, type (create/modify/delete), brief description
- **每个文件修改说明**: Before/after code snippets and reasons
- **测试命令**: Exact commands to run
- **测试结果**: Pass/fail, metrics before/after comparison
- **未解决问题**: List any issues remaining
- **下一步建议**: Specific next steps
- **SOP 候选规则**: Any learnings that could become SOP

### 3. Separation of Concerns
- **Facts**: What happened, what was changed, test results (record in devlog)
- **Judgments**: Why it was done this way, trade-offs (record in devlog)
- **Recommendations**: What to do next (record in devlog)
- **SOP Candidates**: Potential rules for future projects (record in sop-candidates.md)

### 4. SOP Upgrade Restriction
- NEVER write candidate rules directly to Obsidian SOP main document
- Only verified facts can be upgraded to SOP
- Single occurrence → record as issue/note
- Repeated twice+ → consider for checklist
- Project-critical → consider for SOP

### 5. File Locations
- `.ai/project-state.md` - Current project status
- `.ai/devlog/` - Daily task records
- `.ai/sop-candidates.md` - Potential SOP rules (verified before upgrade)
- `.ai/decisions.md` - Key decision history
- `.ai/regression-notes/` - Regression test results and analysis

## Initial Page Scope
Only these pages should be considered first:
- /
- /gamma-watermark-remover
- /notebooklm-watermark-remover
- /ppt-watermark-remover
- /remove-watermark-from-powerpoint
- /privacy-policy
- /terms
- /disclaimer
- /contact

## Do Not Add Yet
- pricing page
- blog system
- CMS
- analytics integrations
- payment logic
- admin area
- auth/account system
- permanent document archive
- queue infrastructure unless clearly required
- billing
- dashboard
- PPTX upload/cleanup support (not in Stage 2 scope)

## Done When
A task is complete only when:
- the page renders correctly
- the layout works on mobile
- metadata is present where needed
- there are no obvious hydration issues
- pnpm lint passes
- pnpm build passes
- `.ai/project-state.md` is updated
- `.ai/devlog/` entry is created (for significant changes)

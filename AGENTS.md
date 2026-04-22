# AGENTS.md

## Project
This repository is for PPTWatermarkRemover, an early-stage temporary-processing PDF cleanup product with supporting marketing and SEO pages.

## Current Stage
Stage 3+ pivot is active: temporary server-side processing is the primary product path.

Core path:
- upload PDF
- temporary job storage
- server-side analyze
- candidate review
- server-side apply
- cleaned artifact download
- delete after download or short expiry

## Current Goals
Build:
- temporary server-side upload flow and cleanup artifacts
- explicit supported-vs-unsupported object-level cleanup behavior
- legal/trust copy aligned to temporary retention and deletion
- marketing pages and SEO pages aligned with real product behavior

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

## Done When
A task is complete only when:
- the page renders correctly
- the layout works on mobile
- metadata is present where needed
- there are no obvious hydration issues
- pnpm lint passes
- pnpm build passes

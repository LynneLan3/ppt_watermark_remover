# AGENTS.md

## Project
This repository is for PPTWatermarkRemover, a marketing website and SEO landing-page project for an AI-export presentation cleanup tool.

## Current Stage
Stage 1 is marketing-only.

Do not build:
- backend file processing
- authentication
- billing
- dashboard
- database
- user accounts
- storage pipelines
- job queues
- API workflows for real cleanup

## Goals for Stage 1
Build:
- marketing homepage
- SEO landing pages
- static legal/support pages
- CTA flows to future upload, contact, or waitlist actions

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
- upload backend
- admin area

## Done When
A task is complete only when:
- the page renders correctly
- the layout works on mobile
- metadata is present where needed
- there are no obvious hydration issues
- pnpm lint passes
- pnpm build passes

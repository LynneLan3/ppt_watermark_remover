# PRD

## Product Name
NotebookLM Watermark Remover

## Product Positioning
A productized NotebookLM cleanup tool with PDF-first, temporary server-side processing and object-level removal focus for supported cases.

## Current Product Promise (Stage 2 Beta)
Upload NotebookLM PDF to a temporary server-side workflow, analyze removable watermark candidates, apply cleanup for supported objects, preview before/after results, download cleaned PDF, and delete all files after download or short expiry.

## Stage Goal
Stage 2 Beta: validate reliability and trust of a real upload -> analyze -> process -> preview -> download workflow for NotebookLM PDF exports.

- Temporary upload with zero retention guarantee
- No training on user documents
- Deletable by user anytime
- Auto-expire after short TTL (20 minutes)
- Blob-backed job storage for serverless compatibility

## Target Users
- freelancers
- agencies
- educators
- creators
- users exporting decks and PDFs from AI presentation tools

## Main Use Cases
- Upload NotebookLM PDF with temporary Blob storage
- Run server-side analysis (detect watermark candidates)
- Run server-side processing (remove supported watermarks)
- Preview before/after results side-by-side
- Download cleaned PDF
- Auto delete artifacts after download or short expiry (20 min)
- Manual delete anytime before expiry

## In Scope (Stage 2 Beta)
- Homepage and SEO landing pages
- Legal/support pages (privacy, terms, disclaimer, contact)
- Main workflow: upload -> analyze -> process -> preview -> download
- NotebookLM PDF temporary upload with Blob-backed storage
- Server-side watermark analysis and cleanup processing
- Before/after preview with page-by-page comparison
- Cleaned PDF download
- Auto delete after download or 20-minute expiry
- Manual delete before expiry
- Zero training / no data retention policy
- MDX-driven content for easy editing

## Out of Scope (Stage 2 Beta)
- User authentication / accounts
- Billing / pricing / payment
- User dashboard
- Blog system / CMS
- Permanent document archive
- Background job queues (not needed for current scale)
- Analytics integrations
- PPTX upload/cleanup (PDF-first only)
- Admin area / multi-user management

## Success Criteria
- Main workflow functional: upload -> analyze -> process -> preview -> download
- Network sequence: create job -> upload PDF -> analyze 200 -> process 200 -> download enabled
- Vercel Preview environment works with Blob-backed storage
- Unsupported watermark cases clearly explained to users
- Legal/trust copy reflects: temporary storage + 20min retention + auto deletion + zero training
- `pnpm lint` and `pnpm build` pass
- Python engine (pikepdf/PyMuPDF) executes correctly on Vercel serverless

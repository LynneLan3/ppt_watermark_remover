# PRD

## Product Name
NotebookLM Watermark Remover

## Product Positioning
A productized NotebookLM cleanup tool with PDF-first, temporary server-side processing and object-level removal focus for supported cases.

## Current Product Promise
Upload PDF to a temporary server-side workflow, analyze removable candidates, apply cleanup for supported objects, download outputs, and delete files after download or short expiry.

## Stage Goal
Stage 2: validate reliability and trust of a real upload -> analysis -> preview -> confirm -> download -> delete workflow for NotebookLM PDF exports.

## Target Users
- freelancers
- agencies
- educators
- creators
- users exporting decks and PDFs from AI presentation tools

## Main Use Cases
- upload NotebookLM PDF with temporary storage
- run server-side analysis and candidate detection
- inspect preview and supported-vs-unsupported statuses
- confirm cleanup action before output generation
- download cleaned PDF and report JSON
- auto delete artifacts after download or short expiry

## In Scope
- homepage and SEO landing pages aligned to productized Stage 2 scope
- legal/support pages
- homepage upload panel temporary upload -> analyze -> preview -> confirm -> download -> delete
- temporary upload and short-lived retention
- deletion after download or expiry
- PDF-first cleanup support for NotebookLM exports
- MDX/content-file-driven copy
- temporary job storage and cleanup utilities
- API contracts and server routes for temp processing
- Python engine execution bridge

## Out of Scope
- accounts / auth
- billing / pricing
- dashboard
- blog system / CMS
- permanent archive/document library
- background job queues (unless clearly required)
- analytics integrations
- PPTX upload/cleanup support for now
- fake “rectangle cover = removal” workflow claims

## Success Criteria
- upload flow shows upload -> analysis -> preview -> confirm -> download -> delete
- unsupported cases are clearly explained
- docs and legal copy align with temporary storage + short retention + deletion + no-training policy
- repository is structured for server-side pikepdf/PyMuPDF execution
- `pnpm lint` and `pnpm build` pass

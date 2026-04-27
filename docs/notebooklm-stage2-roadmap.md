# NotebookLM Stage 2 Roadmap

## Goal
Upgrade from Stage 1 marketing-only positioning to a Stage 2 productized NotebookLM cleanup tool with a real PDF-first workflow and temporary processing guarantees.

## Benchmark Dataset Plan
- Build a curated PDF benchmark set from real-world NotebookLM export patterns, sanitized before storage.
- Target at least 120 files across short (1-5 pages), medium (6-20 pages), and long (20+ pages) documents.
- Label each file with source pattern metadata: repeated footer text, corner logo-like marks, mixed page structures, and flattened backgrounds.
- Track per-file outcomes for analyze success, supported candidate detection, preview quality, cleanup success, and fail-safe behavior.
- Keep benchmark files in internal test fixtures only; no long-term production user-file retention.

## Supported Case Types (Stage 2)
- Repeated text watermark-like objects represented as independent PDF text runs.
- Repeated image/form watermark-like objects represented as independent XObject/Form objects.
- Stable repeated placement patterns across pages (header/footer/corner areas).
- Cases where analysis can confidently mark candidate removability as supported before cleanup.

## Unsupported Case Types (Stage 2)
- Watermarks baked into full-page background images.
- Flattened or rasterized pages without independent removable objects.
- Ambiguous single-instance decorative objects lacking repeated pattern confidence.
- Files that fail validation, exceed limits, or break safe object-level cleanup constraints.
- Direct PPTX input (out of Stage 2 scope; PDF-first only).

## End-to-End Product Flow
1. **Upload**: User uploads a NotebookLM PDF into temporary job storage.
2. **Analysis**: Server runs candidate detection and removability evaluation.
3. **Preview**: User inspects preview and candidate guidance before any output action.
4. **Confirm**: User explicitly confirms cleanup scope/candidate choice.
5. **Download**: System produces cleaned PDF and report JSON for download.
6. **Delete**: Artifacts are auto-deleted after download completion or short expiry.

## Stage 2 Acceptance Criteria
- Real workflow is live and user-visible as `upload -> analysis -> preview -> confirm -> download -> delete`.
- Product copy consistently states PDF-first scope and explicitly avoids PPTX support claims.
- Temporary upload and short-lived retention are enforced and visible in user-facing trust copy.
- Auto deletion after download or expiry is implemented and verifiable in job lifecycle behavior.
- Unsupported structures fail safely with clear guidance instead of destructive fake cleanup.
- No accounts, billing, dashboard, blog, or CMS introduced in Stage 2.
- `pnpm lint` and `pnpm build` pass on the main branch.

# Current Focus

## Product stage
Stage 4 pivot: temporary server-side PDF processing is now the primary workflow.

## Current priorities
1. Keep existing SEO landing pages stable
2. Keep homepage upload panel stable as upload -> analyze -> apply -> download
3. Prioritize independently identifiable objects (logos, headers, footers, brand marks)
4. Maintain temporary job storage + deletion behavior and clear trust messaging

## Core product promise
Provide temporary server-side object-level cleanup for supported structures and fail safely for unsupported structures.

## Hard constraints
- Do not promise that all PDFs can be cleaned
- Do not promise 100% lossless output
- Do not present rectangle cover-up as true removal
- Do not claim 100% security or universal success
- Do not add auth, billing, dashboard, database, or analytics in this stage
- Do not keep files as long-term archive

## Supported-first direction
- Repeated header/footer text objects (text_run, first engine MVP)
- Repeated small brand text marks
- Repeated small image_xobject overlays in supported conditions

## Unsupported-first direction
- Flattened pages and full-page background images
- Scanned/photo-based pages without independent objects
- Cases that would require destructive cover-up to fake removal

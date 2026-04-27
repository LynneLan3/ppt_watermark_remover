# NotebookLM Raster-Page Cleanup MVP

## Goal

Stage 2 keeps the existing object-level cleanup flow, and adds a fallback branch for NotebookLM
exports where each page is essentially a large raster image with a small watermark in the
right-bottom area.

## Analyze Contract

When analyze detects raster-page mode, `review.v1.json` now returns:

- `documentMode: "raster_page"`
- `recommendedProcessMode: "raster_repair_v1"`
- `watermarkRegionHint: "right_bottom"`
- `rasterPageAnalysis` with image-like page ratio and repeated right-bottom mark stats

## Process Contract

`processJob()` now routes by mode:

- `object_level` -> existing `python/process_pdf_v2.py`
- `raster_page` -> `python/process_raster_watermark_v1.py`

Raster process outputs:

- real `processed.pdf` rebuilt from repaired page images
- `process-report.json` with:
  - `processMode: "raster_repair_v1"`
  - `processedPageCount`, `repairedPageCount`, `skippedPageCount`
  - `perPageResults[]`
  - `repairMethodStats`

## Repair Strategy (MVP)

Per page:

1. Render high-resolution pixmap (2x-3x scale)
2. Probe right-bottom ROI with small tolerance offsets
3. Detect dark watermark-like cluster in ROI
4. Repair by simple local methods:
   - `solid_fill`
   - `gradient_fill`
   - `clone_patch`
   - `opencv_inpaint` (optional if OpenCV is available)
5. Insert repaired image back into a same-size PDF page

No external AI API is used.

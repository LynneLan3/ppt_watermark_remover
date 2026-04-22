# PDF Object Removal Plan Direction

## Why this direction
The product now centers on object-level removal, not generic rectangle cover-up. If a target is an independently identifiable PDF object, we can plan deletion while preserving page appearance. If not, the workflow should mark it unsupported.

## Product promise
Prioritize removing independently identifiable logos, headers, footers, and brand-mark objects while preserving the original page appearance as much as possible.

## Why rectangle cover is not the main product path
Rectangle cover-up paints over content. It does not remove the original object from PDF structure and can visually damage complex layouts. This is now treated as legacy/internal fallback logic, not user-facing core workflow.

## Browser vs dedicated engine roles
- Browser (PDF.js): preview rendering, candidate detection signals, candidate selection, scope selection, plan generation.
- Dedicated engine (pikepdf/PyMuPDF): true object-level deletion, repeat-key matching edits, and final verification/export.

## Current phased plan
1. Browser candidate analysis and inspector
2. Structured object-removal plan JSON as machine handoff
3. Python engine scaffold for parsing/grouping/editing/verification
4. Engine implementation for true deletion and diff-based validation

## Plan JSON expectations
The plan should include source file metadata, selected candidate snapshot, selected scope and target pages, preferred engines, preservation goal, risks, and engine hints.

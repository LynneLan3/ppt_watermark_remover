# PDF Supported Cases (Object-Level First)

These are priority-supported cases when independent objects exist in the PDF structure.

## 1) Repeated header text
- Small text objects near top margin repeated across pages.
- Good fit for repeat-key grouping and multi-page object deletion.

## 2) Repeated footer text
- Footer labels or export marks near bottom margin.
- Usually predictable location and repeat behavior.

## 3) Repeated small logo
- Logo image/form objects used across many pages.
- Often removable while preserving nearby content.

## 4) Repeated corner brand mark
- Corner marks reused in fixed coordinates.
- High-value target for “all matching instances” scope.

## 5) Independent image XObject
- A detachable image object separate from background.
- Requires object-level deletion in engine, not cover-up.

## 6) Independent text object
- Text run in PDF text layer, not flattened into image background.
- Can be removed with lower layout risk when validated.

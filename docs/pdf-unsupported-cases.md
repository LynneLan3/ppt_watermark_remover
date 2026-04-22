# PDF Unsupported Cases (Do Not Fake Removal)

These are unsupported-first conditions where independent object deletion is weak or unavailable.

## 1) Baked-in mark inside full-page image
- Mark is embedded in a single background image.
- There is no separate object to delete safely.

## 2) Scanned PDFs
- Page is essentially a scanned bitmap.
- OCR/text layers may not map to removable marks.

## 3) Photo-based PDFs
- Export is image-dominant with merged visual layers.
- Object boundaries are not independently editable.

## 4) Complex backgrounds with no independent mark object
- Decorative or blended marks merged into visual background.
- Removing them requires destructive image editing, not object deletion.

## 5) Any case requiring cover-up to pretend deletion
- White rectangle painting is not true removal.
- This workflow should be flagged as unsupported or review-required.

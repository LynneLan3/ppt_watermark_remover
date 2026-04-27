# Local Engine Workflow

This guide explains the manual handoff from browser planning to local engine execution.

## Browser vs Local Engine Roles

### Browser (Homepage Upload Panel)
- Load a local PDF.
- Analyze candidate objects.
- Select candidate and scope.
- Generate and download a `*.removal-plan.json` file.

### Local engine (`engine/python`)
- Read your input PDF and downloaded plan JSON.
- Validate candidate type and removability.
- Apply supported object-level removal.
- Write output PDF and report JSON.

## Supported Right Now

- Repeated independent `text_run`.
- Repeated small independent `image_xobject`.

## Unsupported Right Now

- `form_xobject` removal.
- Vector-object removal.
- Flattened/baked-in background marks.
- Full-page raster background repair.
- Scanned/photo PDFs.
- Generic rectangle cover-up behavior.

## Setup and Verification

Install dependencies:

```bash
python3 -m pip install -r engine/python/requirements.txt
```

Verify runtime:

```bash
python3 -c "import fitz, pikepdf; print('engine ok')"
PYTHONPATH=engine/python python3 -m unittest discover engine/python/tests
```

## Recommended File Placement

Put the original PDF and downloaded removal plan JSON in the same folder (for example `Downloads`).

Example files in one folder:
- `/Users/<YOUR_USERNAME>/Downloads/mydeck.pdf`
- `/Users/<YOUR_USERNAME>/Downloads/mydeck.removal-plan.json`

## Preflight Checklist

Before running commands, confirm:
- Original PDF is saved locally.
- Downloaded removal plan JSON is saved locally.
- Both files are in the expected folder.
- `<YOUR_USERNAME>` is replaced with your actual macOS username.
- Paths and filenames in the command match real local files.

## Command Modes

### Template command
Use when you want full custom paths:

```bash
python3 engine/python/cli.py apply-plan \
  --input "<ABSOLUTE_PATH_TO_INPUT_PDF>" \
  --plan "<ABSOLUTE_PATH_TO_PLAN_JSON>" \
  --output "<ABSOLUTE_PATH_TO_OUTPUT_CLEANED_PDF>" \
  --report "<ABSOLUTE_PATH_TO_OUTPUT_REPORT_JSON>"
```

Do not run literal placeholder values unchanged.

### Worked example command
Using the example `mydeck.pdf` in Downloads:

```bash
python3 engine/python/cli.py apply-plan \
  --input "/Users/<YOUR_USERNAME>/Downloads/mydeck.pdf" \
  --plan "/Users/<YOUR_USERNAME>/Downloads/mydeck.removal-plan.json" \
  --output "/Users/<YOUR_USERNAME>/Downloads/mydeck.cleaned.pdf" \
  --report "/Users/<YOUR_USERNAME>/Downloads/mydeck.report.json"
```

Replace:
- `<YOUR_USERNAME>` with your macOS username.
- The folder path if files are not in `Downloads`.
- The filenames if your real local names are different.

## Analyze Command

```bash
python3 engine/python/cli.py analyze \
  --input "/Users/<YOUR_USERNAME>/Downloads/mydeck.pdf" \
  --output "/Users/<YOUR_USERNAME>/Downloads/mydeck.analysis.json"
```

## Output Files and Location

After `apply-plan`, expected outputs are:
- `<name>.cleaned.pdf`
- `<name>.report.json`

They are written to the same folder path used in `--output` and `--report` unless you change those paths.

## How to Read the Result

- The cleaned PDF is the output file to inspect visually.
- The report JSON is the structured outcome summary.
- Key report fields:
  - `success`
  - `objectType`
  - `matchedObjectsCount`
  - `removedObjectsCount`
  - `warnings`
  - `failureReason`

### Success report example

```json
{
  "success": true,
  "objectType": "text_run",
  "matchedObjectsCount": 4,
  "removedObjectsCount": 4,
  "warnings": [],
  "failureReason": null
}
```

Interpretation:
- `success=true` means removal completed.
- `matchedObjectsCount` and `removedObjectsCount` show how many targets were found and removed.
- `warnings` can still include non-fatal notes.

### Fail-safe report example

```json
{
  "success": false,
  "objectType": "image_xobject",
  "matchedObjectsCount": 0,
  "removedObjectsCount": 0,
  "warnings": [],
  "failureReason": "Matched repeat group is not marked supported; refusing to apply removal."
}
```

Interpretation:
- `success=false` with `failureReason` means safe refusal occurred.
- This is expected for unsafe/unsupported candidates.
- Choose a supported candidate and regenerate plan.

## Success vs Fail-Safe Abort

- Success means supported candidate objects were matched and removed.
- Fail-safe abort means the engine refused to proceed because the candidate was unsafe or unsupported.
- Fail-safe abort is expected behavior for unsupported cases, not a broken workflow.

## Common Mistakes and Fixes

- File not found:
  - Fix: verify the file exists at the exact path used in the command.
- Wrong folder path:
  - Fix: update the folder path consistently for `--input`, `--plan`, `--output`, and `--report`.
- Wrong filename:
  - Fix: ensure command filenames exactly match your local PDF and downloaded plan JSON.
- Plan JSON path mismatch:
  - Fix: confirm `--plan` points to the downloaded `.removal-plan.json`.
- Placeholder paths run literally:
  - Fix: replace `<YOUR_USERNAME>` and any placeholder path tokens before running.
- Unsupported object / fail-safe abort:
  - Fix: select a supported candidate from the homepage upload panel and regenerate plan.

## When to Regenerate the Plan

- Regenerate if you choose a different candidate.
- Regenerate if you change scope or page range.
- Regenerate if the source PDF changes.
- Do not reuse an old plan for a different file.

## Quick Path

1. Download the removal plan JSON from the homepage upload panel.
2. Put the source PDF and plan JSON in `Downloads`.
3. Copy the example command.
4. Replace `<YOUR_USERNAME>`.
5. Run in Terminal.
6. Open `.cleaned.pdf` and `.report.json`.

# Python Local Engine MVP (text_run + narrow image_xobject)

This round supports deterministic, fail-safe local removal for:
- repeated independent `text_run`
- repeated small independent `image_xobject` overlays (corner logos / small brand icons)

## Not supported
- `form_xobject` removal
- vector-object removal
- flattened/full-page background restoration
- scanned/photo PDF cleanup
- generic "remove anything in rectangle"

## Fail-safe policy
If a candidate is ambiguous, too large, non-repeating, low confidence, or background-like, `apply-plan` aborts and writes a failure report.

## Setup

```bash
python3 -m pip install -r engine/python/requirements.txt
```

## Generate deterministic fixtures

```bash
PYTHONPATH=engine/python python3 engine/python/tests/generate_fixtures.py
```

Generated in `engine/python/tests/fixtures/`:
- `repeated_header_text.pdf`
- `repeated_footer_text.pdf`
- `repeated_small_brand_text.pdf`
- `unsupported_non_repeated_text.pdf`
- `unsupported_flattened_case.pdf`
- `repeated_corner_logo_image.pdf`
- `repeated_small_brand_icon.pdf`
- `unsupported_full_page_image.pdf`
- `example_plan_header_text.json`
- `example_plan_corner_logo_image.json`

## Analyze

```bash
python3 engine/python/cli.py analyze \
  --input engine/python/tests/fixtures/repeated_corner_logo_image.pdf \
  --output /tmp/corner-logo.analysis.json
```

## Apply plan

```bash
python3 engine/python/cli.py apply-plan \
  --input engine/python/tests/fixtures/repeated_corner_logo_image.pdf \
  --plan engine/python/tests/fixtures/example_plan_corner_logo_image.json \
  --output /tmp/corner-logo.output.pdf \
  --report /tmp/corner-logo.report.json
```

## Demo scripts

Text demo:
```bash
PYTHONPATH=engine/python python3 engine/python/demo_text_run_mvp.py
```

Image demo:
```bash
PYTHONPATH=engine/python python3 engine/python/demo_image_xobject_mvp.py
```

## Gamma / NotebookLM corpus validation

Run real-sample validation with per-file summary:

```bash
PYTHONPATH=engine/python python3 engine/python/validation/corpus_validation.py \
  --samples-root "/path/to/sample-corpus" \
  --output-prefix "temp/validation/gamma-notebooklm-summary" \
  --source-types "gamma,notebooklm,other" \
  --mode "analyze-apply" \
  --work-dir "temp/validation/runs"
```

Outputs:
- `gamma-notebooklm-summary.json`
- `gamma-notebooklm-summary.csv`
- `gamma-notebooklm-summary.md`

Sample corpus layout:
- `<corpus-root>/gamma/*.pdf`
- `<corpus-root>/notebooklm/*.pdf`
- `<corpus-root>/other/*.pdf`

Useful flags:
- `--max-files 20` for quick baseline slices
- `--mode analyze-only` for distribution-only dry runs

See `docs/gamma-notebooklm-validation.md` for schema, aggregate metrics, and interpretation.
See `docs/object-level-support-matrix.md` for current Gamma-first / NotebookLM-limited positioning.

## Output guarantees
- Deterministic candidate/group ordering in analysis JSON.
- `analyze`/`apply-plan` JSON outputs use sorted keys.
- Stable fixture generation for reproducible tests.

## Planner compatibility
The engine consumes plan schema emitted by `/app/upload` (`planVersion 1.0`) and supports:
- `selectedCandidate.objectType = text_run | image_xobject`
- `selectedCandidate.repeatKey`
- `selectedCandidate.confidence`
- `selectedCandidate.removability`
- `scope.targetPages`
- plus image hints (`imageIdentityKey` / `resourceName`) for image plans.

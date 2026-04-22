# Temporary Processing Tests

## Run tests

- `pnpm test`

## What this suite covers

The `tests/temp-processing` suite focuses on critical regression paths for the temporary-processing beta backend:

- upload validation failures (`validation_error`)
- analyze timeout classification (`runner_timeout`)
- analyze terminal outcomes (`no_candidates`, `unsupported_structure`)
- missing artifact download failures (`artifact_missing`)
- cleanup failures (`cleanup_failed`)
- deletion policy behavior (`delete_after_both_downloads_or_expiry`)
- expiry cleanup path behavior
- happy-path integration flow:
  - upload -> analyze -> apply -> cleaned/report download -> cleanup

For Gamma/NotebookLM real-file quality checks, use the corpus workflow in
`docs/gamma-notebooklm-validation.md` (JSON + CSV + Markdown summaries).
Use source-type folders (`gamma/`, `notebooklm/`, `other/`) and prioritization fields
to choose the next engine reason-code fixes.
Current baseline positioning is summarized in `docs/object-level-support-matrix.md`.

## What is intentionally not covered yet

- full browser E2E scenarios
- exhaustive Python engine correctness tests
- large-file performance/load tests
- multi-worker queue/distributed cleanup behavior

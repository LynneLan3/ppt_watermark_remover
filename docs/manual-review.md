# Manual Review (Internal)

This page is for local/testing only.

## Enable

Set `.env.local`:

```bash
ENABLE_MANUAL_REVIEW=true
MANUAL_REVIEW_TMP_DIR=tmp/manual-review
WATERMARK_ALGORITHM_PROFILE=stable-light-complex-v5
# optional, default false
WATERMARK_ENABLE_V6_MICRO_POLISH=false
```

Open: `/app/manual-review`

## Manual QA Labels

- Pass
- Minor Residue
- Visible Residue
- White Patch
- Hard Edge
- Text / Line Damage
- Severe Fail

## Job Artifacts

Each run stores files under:

```text
tmp/manual-review/{jobId}/original.pdf
tmp/manual-review/{jobId}/processed.pdf
tmp/manual-review/{jobId}/process-report.json
tmp/manual-review/{jobId}/logs.txt
```

QA export stores page artifacts under:

```text
tmp/manual-review/{jobId}/qa/page-{n}/original-page.png
tmp/manual-review/{jobId}/qa/page-{n}/processed-page.png
tmp/manual-review/{jobId}/qa/page-{n}/bottom-right-original-crop.png
tmp/manual-review/{jobId}/qa/page-{n}/bottom-right-processed-crop.png
tmp/manual-review/{jobId}/qa/page-{n}/...overlay/heatmap (if available)
tmp/manual-review/{jobId}/qa/qa-dataset.json
tmp/manual-review/{jobId}/qa/qa-summary.json
```

## Python Command Used By API

The API writes a request json, then calls:

```bash
python3 python/process_raster_watermark_v1.py \
  --request tmp/manual-review/{jobId}/request.json \
  --input tmp/manual-review/{jobId}/original.pdf \
  --output tmp/manual-review/{jobId}/processed.pdf \
  --report tmp/manual-review/{jobId}/process-report.json
```

`request.json` contains `rasterProcessConfig.enableSeamMicroPolish=false` in current Beta freeze, so v6 micro polish remains disabled.

## QA Export APIs

- `POST /api/manual-review/jobs/:jobId/qa/artifacts`
- `POST /api/manual-review/jobs/:jobId/qa/summary`
- `GET /api/manual-review/jobs/:jobId/qa-dataset.json`
- `GET /api/manual-review/jobs/:jobId/qa-summary.json`

## Cleanup

```bash
pnpm manual-review:clean
```

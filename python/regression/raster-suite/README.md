# Raster Regression Suite (Light / Complex)

把 NotebookLM PDF 样本放到本目录下对应子目录：

- `samples/dark_baseline/`
- `samples/light/`
- `samples/mixed/`

样本清单在 `manifest.v1.json`，按 `pdfPath` 相对路径查找。

运行：

```bash
python3 python/raster_regression_suite.py \
  --manifest python/regression/raster-suite/manifest.v1.json \
  --output-dir python/regression/raster-suite/results
```

输出：

- `regression-suite-results.v1.json`（结构化结果）
- `regression-suite-summary.v1.md`（按 PDF + 按分类总表）

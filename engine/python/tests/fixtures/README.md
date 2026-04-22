# Engine Fixtures

Deterministic local fixture artifacts for `text_run` and narrow `image_xobject` tests.

Generate/update all fixtures:

```bash
PYTHONPATH=engine/python python3 engine/python/tests/generate_fixtures.py
```

## Text fixtures
- `repeated_header_text.pdf`
- `repeated_footer_text.pdf`
- `repeated_small_brand_text.pdf`
- `unsupported_non_repeated_text.pdf`
- `unsupported_flattened_case.pdf` (image-only placeholder)

## Image fixtures
- `repeated_corner_logo_image.pdf`
- `repeated_small_brand_icon.pdf`
- `unsupported_full_page_image.pdf`

## Example plans
- `example_plan_header_text.json`
- `example_plan_corner_logo_image.json`

## Intended characteristics

### Supported text
- repeated independent text objects near header/footer/corner

### Supported image_xobject
- repeated small independent image overlays (corner logo / small icon)
- repeated across multiple pages with stable position and size

### Unsupported image
- full-page or near-full-page image content (`unsupported_full_page_image.pdf`)
- flattened/background-like content where safe independent removal is ambiguous

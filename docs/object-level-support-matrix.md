# Object-Level Support Matrix (Current Baseline)

This matrix reflects current real-corpus behavior under the temporary-processing, object-level strategy.

## Source-level status

- **Gamma exports**: strongest supported path, currently plateaued at `usableRate=0.6667` (Round 5F).
- **NotebookLM exports**: limited / experimental support in current stage.

## Pattern-level status

- **Repeated header/footer text**: supported when independently identifiable.
- **Repeated small corner logo (`image_xobject`)**: supported when independently identifiable.
- **Background-baked / large-image branding**: not supported (fail-safe).
- **Non-repeated decorative image marks**: not supported (fail-safe).
- **Flattened/non-independent watermark structures**: not supported (fail-safe).

## Product behavior rules

- Unsupported structures must remain fail-safe.
- Do not auto-enable apply for unsupported/review-required objects.
- Prefer recommendation paths for Gamma-like repeated header/footer/corner candidates.

## Next optimization focus

- Round 5F plateau diagnosis on failing Gamma files shows:
  1. `CADA.pdf`: no repeatable removable pattern (`repeatCount>=2` absent), non-recoverable under current object-level strategy.
  2. `r4pdv3d2bz862ld.pdf`: only large background repeats; would require broader strategy change, not a small rule tweak.
- Current recommendation:
  1. pause broad Gamma engine expansion for now
  2. move into scoped beta with explicit unsupported boundaries
  3. keep fail-safe behavior strict for background-baked / flattened structures

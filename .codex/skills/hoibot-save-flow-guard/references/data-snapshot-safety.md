# Data Snapshot Safety

`data/*.json` files are production-like snapshots.

## Rules

- Do not overwrite original snapshots.
- Do not run mutation scripts directly against snapshots.
- For ordinary legacy validation, use copies for mutation tests. For modernization slices, use non-identifying synthetic fixtures only; copying an operational snapshot does not make it permitted test input.
- Validate JSON with read-only parsing when possible.

## Validation

For JSON parse checks, prefer read-only scripts that do not write files.

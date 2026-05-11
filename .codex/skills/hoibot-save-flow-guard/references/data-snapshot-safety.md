# Data Snapshot Safety

`data/*.json` files are production-like snapshots.

## Rules

- Do not overwrite original snapshots.
- Do not run mutation scripts directly against snapshots.
- Use copies for parsing or mutation tests.
- Validate JSON with read-only parsing when possible.

## Validation

For JSON parse checks, prefer read-only scripts that do not write files.

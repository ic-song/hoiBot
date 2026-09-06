# Wave8 dependency boundary

- Source commit: `e7cb24a77fef4727c396d1c7a728dc5e79686ce9`.
- Frozen consumer denominator and classifications remain the existing `object-db-consumer-manifest.v1.json` and registry; Wave8 only adds executable evidence for four existing IDs.
- The Wave1~7 shared runner remains byte-identical to its immutable receipts. Wave8 uses the allowlisted self-contained `object-db-executable-parity-wave8-harness.mjs` with explicit mutation errors and runner-owned transaction-attempt evidence.
- Actual runtime dependencies: `IrisAdminCommandService`, four command guards/services, `CommandDispatcher`, and their Maria repositories. Inputs, SQL, values, rows, results, DML, locks and transaction boundaries are fixture-bound.
- Synthetic dependencies only: fixed UTC DB clock, deterministic rows and insert IDs, UUID-v4 matcher, isolated child processes. External reply/network and Maria production state are outside the boundary.
- Prior Wave1~7 receipts and hashes are copied byte-for-byte; Wave8 does not rewrite their immutable evidence or provenance.

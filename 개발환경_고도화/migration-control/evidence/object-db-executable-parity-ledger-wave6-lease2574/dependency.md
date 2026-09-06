# Wave6 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; the runner was extended only with ordered query plans, typed row adapters, runner-owned exact query traces, and missing/extra query fail-close behavior.
- Executes actual committed TypeScript `MariaPlayerContextProvider.resolveSelf` and `BagShadowParityProvider.compare` through `tsx`; no duplicate provider or production wiring was added.
- Trusted-input provenance commit: `089585eb23695edf995193d64d44516dfd981c02`.
- Fixture, runner, target, provider source spans, exact SQL/parameters/rows/results, Git ancestry, blobs and hashes are attested by the strict validator.
- Prior `45` receipts retain their semantics; only the additive shared-runner `sourceSha256` and dependent `receiptSha256` were refreshed (`45/45`, semantic drift `0`).
- No schema, migration, shared production provider, `main.js`, `Info.js`, data snapshot, feature/prod, Gate, or operational DB change.


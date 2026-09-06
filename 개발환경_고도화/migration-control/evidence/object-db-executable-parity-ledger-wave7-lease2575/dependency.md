# Wave7 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; only seven source-shaped row adapters were added to the shared synthetic query engine.
- Executes actual committed `PointShopCatalogIrisHandler`, `PackageIrisCommandHandler`, and `PackageCatalogAddWizardIrisHandler` modules through `tsx`; their real service and repository/provider dependencies receive the synthetic database.
- Trusted-input provenance commit: `794aba882696290426863a3b312ca6c546e5108e`.
- The strict validator binds frozen consumer source spans, current dispatch spans, downstream chain spans/needles, exact invocation, fixture, runner, target, Git ancestry, blobs and hashes.
- Prior `55` receipts retain their semantics; only the additive shared-runner `sourceSha256` and dependent `receiptSha256` were refreshed (`55/55`, semantic drift `0`).
- No schema, migration, production provider wiring, `main.js`, `Info.js`, data snapshot, Sheet, feature/prod, Gate, operational DB, external reply or network change.

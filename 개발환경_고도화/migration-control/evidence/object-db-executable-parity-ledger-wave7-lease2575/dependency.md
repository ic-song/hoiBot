# Wave7 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; seven source-shaped row adapters plus runner-owned exact mutation trace and UUID-v4 matcher support the synthetic database.
- Executes actual committed `PointShopCatalogIrisHandler`, `PackageIrisCommandHandler`, `PackageCatalogAddWizardIrisHandler`, downstream services/providers, and `ProcessIrisEventService.queueCommandReply` through `tsx`.
- Trusted-input provenance commit: `265b95f38a265ff7163f14243c4d723c222539f3`.
- The strict validator binds frozen consumer source spans, current dispatch spans, downstream chain spans/needles, exact invocation, fixture, runner, target, Git ancestry, blobs and hashes.
- Prior `55` receipts retain their semantics; only the additive shared-runner `sourceSha256` and dependent `receiptSha256` were refreshed (`55/55`, semantic drift `0`).
- The synthetic database stops at committed outbox rows. No schema, migration, production provider wiring, `main.js`, `Info.js`, data snapshot, Sheet, feature/prod, Gate, operational DB, external reply or network change.

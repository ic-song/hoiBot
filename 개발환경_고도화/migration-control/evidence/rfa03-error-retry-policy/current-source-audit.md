# RFA-03 current source audit

- catalog: `SC-20260902-1`
- lease: `2564`
- baseline: `2911301991c8630ab8cf097a9820179adf2f9a0f`
- scope: shared DB error/retry policy, canonical identity provider adoption, focused tests and evidence

## Search terms

`ER_DUP_ENTRY`, `1062`, `ER_LOCK_DEADLOCK`, `1213`, `ER_LOCK_WAIT_TIMEOUT`, `1205`, `ER_NO_REFERENCED_ROW_2`, `1452`, `ER_ROW_IS_REFERENCED_2`, `1451`, `createObjectIdentityCandidate`, `reserveIdentity`, `createObjectAuditValues`, `formatKstDateTime`, `withTransaction`.

## Findings

- `runtime/src/identity/object-identity-audit-provider.ts` is the canonical CUID2-8 and KST audit provider. Audit formatting already complies with `YYYY-MM-DD HH:MM:SS` in Asia/Seoul and is retained.
- Its former `reserveIdentity` retried every broadly detected duplicate. That could classify a business UNIQUE conflict as a generated PK collision.
- Its former transaction loop accepted duplicate and 1213/1205 together, then performed a concurrent source lookup. The intended domain behavior is narrower: only `uq_object_identity_crosswalk_source` can become an idempotent concurrent replay.
- Source inventory found 69 TypeScript files mentioning lock conflicts and 52 mentioning duplicate conflicts. These are an adoption inventory, not proof that every occurrence is wrong.
- Several existing domain-local helpers mix `ER_DUP_ENTRY` with 1213/1205. RFA-03 does not sweep them because their UNIQUE-race semantics belong to each consumer and bulk replacement would erase domain-specific allowed decisions.
- ID inventory found 328 files using legacy `randomUUID` operation identifiers and 14 files importing or defining the canonical CUID provider. UUID operation identifiers are not object CUID PKs and remain unchanged.
- Local CUID insert loops exist in account-platform, catalog projection, common staging, item25 definition, raw landing and canonical inventory code; app-wiring, building recipe, pet exploration and pet-title mutation also consume the shared generator. They are recorded for later consumer-owned adoption rather than silently rewritten.
- Audit inventory found 22 files with standard audit columns/helper usage. `object-identity-audit-provider.ts` remains the single `Intl.DateTimeFormat(... Asia/Seoul)` implementation for object audit values. The broader 345-file clock/`UTC_TIMESTAMP` search mostly covers legacy operation timestamps, not object audit `CHAR(19)` generation, and is not converted here.
- RFA-01 and RFA-02 remain unchanged dependencies. Their request identity, receipt, outbox, ambiguity and replay behavior is not reimplemented.

## Implemented boundary

1. Maria errors are classified only when the connector `code` and numeric `errno` pair exactly match.
2. A duplicate is a CUID8 collision only inside a generated-candidate insert boundary, with a valid 8-character candidate and the explicitly expected primary-key name.
3. Other 1062 errors remain business UNIQUE conflicts; 1451/1452 remain FK conflicts and are never CUID retries.
4. 1213/1205 retries call the explicit root capability `withRootTransaction` again, so every retry owns a fresh transaction boundary.
5. The runtime DB client exposes an explicit `withRootTransaction` capability. Savepoint/scoped clients do not expose it, so they propagate 1213/1205 unchanged to the root owner instead of retrying the same transaction object.
6. The domain must explicitly allow each deadlock/timeout kind. The policy does not infer business permission.
7. Canonical identity source-UNIQUE replay is preserved only for `uq_object_identity_crosswalk_source` after rollback and committed re-read.

## Deferred adoption

No command/dispatcher/domain consumer was newly adopted. The 69/52-file inventory must be handled by stable consumer owners that preserve each domain's UNIQUE replay/version-conflict rules. No applied migration, production data, `main.js`, `Info.js`, or Gate 8 surface changed.

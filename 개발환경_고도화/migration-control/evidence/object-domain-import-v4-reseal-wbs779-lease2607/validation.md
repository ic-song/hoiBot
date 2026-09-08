# WBS779 object-domain import V4 forward reseal validation

- Catalog: `SC-20260902-1`
- Lease: `슬라이스_선점!2607`
- Branch: `codex/object-domain-import-v4-reseal-v1-20260908`
- Boundary: contracts, importer profile selection, synthetic tests, disposable non-production MariaDB only. Operational data, operating DB, live rooms, network delivery, `feature/prod`, and Sheets were not changed.

## Gate evidence

1. Gate1: the audit reproduced three stale-boundary failures: the exact migration assertion stopped before migrations 484/485 and later entries; the immutable V1 disposition classified 90 of the current 119 registered tables; and the immutable V1 target schema/field map omitted eleven pet-skill definition columns introduced by migrations 481/484 while migration 482 amended Unicode grade storage.
2. Gate2: immutable V1/V2 contracts and applied migrations remain byte-untouched. Additive V4 profile, import contract, disposition amendment, target-schema amendment, and field-map amendment bind the current state.
3. Gate3: the regression fixture proves the exact 39-migration sequence, an exact one-time classification of 119 tables (`90 + 29`), and the exact eleven-column qualified field-map/schema set.
4. Gate4: `--profile v4` is selectable by the importer CLI. V2 additions are applied first, V3 item-bag completeness stays bound to its creating profile, and the V4 eleven-column amendment is then applied without changing the 47 direct targets. V1 alone retains its historical pre-466 allowlist; V2/V3/V4 accept only their current semantic contract.
5. Gate5: disposable MariaDB `11.4` on loopback port `3342` ran the four item-bag completeness/restart-safe ordering tests and was removed afterward. It did not contact port 3306 or the persistent modernization database.
6. Gate6: the focused object-model/import/disposition/field-map/target-schema/V3/V4 suite passed `82/82`; the narrower importer/V3/V4 replay suite passed `39/39`. V1/V2/V3 semantic hashes and replay/rollback remain green after the version-sensitive pet-skill projection correction.
7. Gate7: contract hashes, duplicate/missing table checks, duplicate/missing V4 column checks, second-application rejection, malformed profile rejection, and cross-profile replay denial are fail-closed. No runtime command reply path or legacy JSON save flow was modified.

## Commands and results

- `node --import tsx --test test/object-data-model-contract.test.ts test/object-domain-import-v4-reseal.test.ts test/object-domain-import-disposition.test.ts test/object-domain-import-field-map.test.ts test/object-domain-import-target-schema.test.ts test/data-migration-object-domain-import.test.ts test/item-bag-import-completeness-v3.test.ts`: `82/82 PASS`
- `node --import tsx --test test/object-domain-import-v4-reseal.test.ts test/data-migration-object-domain-import.test.ts test/item-bag-import-completeness-v3.test.ts`: `39/39 PASS`
- disposable MariaDB: `RUN_ITEM_BAG_COMPLETENESS_MARIADB_INTEGRATION=true ... test/item-bag-import-completeness-v3-mariadb.integration.test.ts`: `4/4 PASS`, container removed
- `npm.cmd run typecheck`: `PASS`
- `npm.cmd run build`: `PASS`
- `npm.cmd run object-data:validate`: `PASS`, registered tables `119`
- `node --check main.js`, `node --check Info.js`: `PASS`

## Exact V4 seals

- Profile semantic SHA-256: `e33533d670338c8665c2ba36aed5ff291852aa8bc1e5a00e48c9c6952f10b97f`
- Import contract semantic SHA-256: `3fb9d21b789a69f564931bea3052c0566872b1da73ba1e38a4df9aed1a6e5f36`
- Disposition amendment SHA-256: `15d15fdd450fab707ef94ffdcf1a1613ea1db271f302fcfc9c01d90e26063968`
- Target-schema amendment SHA-256: `4f9f93c6befa0cfb0d424e897cb6a9dbce6e09435fba054cd93870820cd9da4f`
- Field-map amendment SHA-256: `73cfe78b51f357db0ef9fbff3e0233df11afbebe2fe4815a1130e6fa8a333745`

## Unverified / excluded

- No operational snapshot import, operating database replay, live-room reply, external network delivery, or Gate8 cutover was run.
- The V4 contract adds import selection and exact schema/disposition bindings; no current operating migration or data is rewritten.

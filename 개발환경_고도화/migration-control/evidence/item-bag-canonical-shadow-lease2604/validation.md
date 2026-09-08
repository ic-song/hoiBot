# WBS776 validation

## Commands and results

- Focused/shared: `node --import tsx --test test/app-wiring-read-only-recovery-provider.test.ts test/bag-read.test.ts test/bag-shadow-parity-provider.test.ts test/canonical-item-bag-direct-read-service.test.ts test/canonical-item-bag-import-readiness-provider.test.ts test/canonical-item-bag-shadow-read-provider.test.ts test/item-bag-shadow-http.test.ts test/legacy-bag-owner-label-provider.test.ts test/object-db-consumer-transition-contract.test.ts` — `77/77 PASS`.
- TypeScript: `npm run typecheck` — PASS.
- Build: `npm run build` — PASS.
- Object standard: `npm run object-data:validate` — PASS, 111 registered targets.
- Legacy syntax: `node --check main.js` and `node --check Info.js` — PASS.
- Diff hygiene: `git diff --check` — PASS.
- Isolated MariaDB: with the exact `ITEM_BAG_TEST_DB_*` allowlist and `ITEM_BAG_ALLOW_DESTRUCTIVE_SEED=hoibot_rehearsal_item_bag_2604`, `node --import tsx --test test/item-bag-shadow-mariadb.integration.test.ts` — `4/4 PASS` against `127.0.0.1:3308/hoibot_rehearsal_item_bag_2604` after all `475` migrations. The pure guard rejects mismatched targets before client creation; connected identity is verified before seed and after pool reconstruction. Non-silent replay rejects tampered or missing legacy outbox data, and the castle-silent case creates zero legacy outboxes.
- Frozen manifest regeneration: `node --import tsx scripts/build-object-db-consumer-transition-manifest.ts` — `1,132` consumers, `SQL_REPOSITORY=83`, consumer-set SHA-256 `b722adc73e5baecb694587d57c45e0989b72442ccaa12d7e7c0490840b5c425f`.
- Executable ledger: official rebuild/validator PASS at 1,132 entries; existing `DIRECT_PASS=31`, new owner/import consumers `STATIC_ONLY`, entry-set SHA-256 `1ffc1ad88fe31ed708df38e25b7a4eb2b142aa709201b2d991a3362627c37bf7`.
- Transition contract: `node --import tsx --test test/object-db-consumer-transition-contract.test.ts` — `14/14 PASS`; ITEM remains `SHADOW_ONLY`, `ITEM_BAG_MODERN` remains pending.

## Actual ingress recovery assertion

`item-bag-shadow-http.test.ts` executes `buildApp().inject` with `/가방`. The command registry must resolve the exact command as SHADOW before canonical evaluation. A synthetic transient transaction failure rolls back before commit; retry atomically commits the post-evaluation legacy outbox and SHADOW receipt. A historical processed event lacking a receipt is rejected before outbox insertion. Evaluation error and silent outcomes do not enqueue a transitional legacy reply.

- legacy outbox inserts: exactly `1`
- immediate `sendIrisTextReply` calls: exactly `0`
- receipt version: `ITEM_BAG_CANONICAL_DIRECT_READ_V1`
- receipt decision: `legacy_reply / CANONICAL_IMPORT_INCOMPLETE`
- canonical evaluator text is absent from the queued outbox payload
- queued legacy payload is byte-exact for the fixture, including Korean, emoji, newline, and sponsor notice
- completed replay checks the linked legacy outbox on both the normal root replay and failure-reconciliation COMPLETED branch; WBS776 integration cases explicitly exercise missing and payload drift, while duplicate, destination, status, and type drift are enforced by the same exact validator

The synthetic transient-failure injection demonstrates atomic retry cardinality and callback count zero. The separate Maria integration proves same-event SHADOW receipt/outbox cardinality across app/pool reconstruction, exact active-subaccount canonical evaluation, complete/incomplete provenance, castle suppression, and unchanged fixture legacy/canonical quantities. These checks do not claim process-level restart or external-network observation. The transitional legacy Maria payload still follows the caller-linked legacy repository and is not counted as active-subaccount or canonical DIRECT evidence.

## Sources searched and reused

- `main.js`: `/가방`, `ㄴㄴㄴ`, `generateBagOutput`, `checkRank`, `getGuildMasterRankEmoji`, `castleSiegeFlag`, `allsee`.
- `runtime/src/pet/pet-title-app-wiring-ingress.ts`: world guild territory authority query and `resolveGuildTerritoryWarAuthority` pattern.
- `runtime/src/pet/pet-skill-info-shadow-service.ts`: marker/membership presentation projection pattern.
- `runtime/src/pet/pet-skill-info-read-only-recovery-ingress.ts` and `runtime/src/dispatch/app-wiring-read-only-recovery-provider.ts`: receipt, replay, duplicate, and read-only snapshot pattern.
- `runtime/src/inventory/maria-bag-repository.ts`, `legacy-bag-formatter.ts`, `bag-shadow-parity-provider.ts`: transitional legacy output and the byte-preserved Wave6 stack parity provider.
- `runtime/src/inventory/canonical-item-bag-shadow-read-provider.ts`, `legacy-bag-owner-label-provider.ts`, `canonical-item-bag-import-readiness-provider.ts`: WBS776 corrected active-player/parity composition and two additive `STATIC_ONLY` ITEM READ consumers.
- import contracts/tables: `data_migration_object_domain_import_runs`, `data_migration_object_domain_import_records`, `canonical_owned_item_stacks`, `canonical_item_definitions`.
- authority/read models: `guild_territory_start_scopes`, `guild_territory_wars`, `operation_notice_heads`, `configuration_values`, rank marker and guild rank projections.

## Proven / missing / uncertain

- Proven: SELECT-only canonical evaluator, exact resolved player-id binding, precise castle suppression authority, owner marker/rank formatting, operation notice source, stack parity, negative guards, registry-controlled SHADOW evaluation, SHADOW receipt replay across app/pool reconstruction, exact non-silent outbox cardinality one, silent outbox cardinality zero, replay outbox-integrity rejection, immediate HTTP callback count zero, and unchanged fixture quantities.
- Missing: importer-generated zero-row/post-import per-player completeness, full owned-instance/equipment/pet coverage, operational import provenance for this consumer, MODERN route and DIRECT receipt.
- Uncertain and therefore fail-closed: any operational player whose import receipts are incomplete/duplicated, presentation snapshot drifts, castle authority is not exactly one row, or canonical contains an out-of-scope record.

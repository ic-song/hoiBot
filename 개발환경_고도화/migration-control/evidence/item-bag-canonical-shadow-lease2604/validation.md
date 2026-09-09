# WBS776 validation

## Commands and results

- Focused/shared: `node --import tsx --test test/app-wiring-read-only-recovery-provider.test.ts test/bag-read.test.ts test/bag-shadow-parity-provider.test.ts test/canonical-item-bag-direct-read-service.test.ts test/canonical-item-bag-import-readiness-provider.test.ts test/canonical-item-bag-shadow-read-provider.test.ts test/item-bag-shadow-http.test.ts test/legacy-bag-owner-label-provider.test.ts test/object-db-consumer-transition-contract.test.ts` — `77/77 PASS`.
- TypeScript: `npm run typecheck` — PASS.
- Build: `npm run build` — PASS.
- Object standard: `npm run object-data:validate` — PASS, 119 registered targets.
- Legacy syntax: `node --check main.js` and `node --check Info.js` — PASS.
- Diff hygiene: `git diff --check` — PASS.
- Isolated MariaDB: with the exact `ITEM_BAG_TEST_DB_*` allowlist and `ITEM_BAG_ALLOW_DESTRUCTIVE_SEED=hoibot_rehearsal_item_bag_2604`, `node --import tsx --test test/item-bag-shadow-mariadb.integration.test.ts` — `4/4 PASS` against `127.0.0.1:3308/hoibot_rehearsal_item_bag_2604` after all `475` migrations. The pure guard rejects mismatched targets before client creation; connected identity is verified before seed and after pool reconstruction. Non-silent replay rejects tampered or missing legacy outbox data, and the castle-silent case creates zero legacy outboxes.
- The later WBS777/WBS778 corrections add migrations `488`, `489`, and `490`; the current branch therefore has `478` normal forward migrations. Their isolated MariaDB receipts, rollback-refusal/reapply evidence, and LF-normalized fresh-checkout verification are separately sealed under the WBS777/WBS778 evidence. This document does not rewrite the earlier 475-migration WBS776 run as a 478-migration run.
- Frozen manifest regeneration: `node --import tsx scripts/build-object-db-consumer-transition-manifest.ts` — `1,133` consumers, `SQL_REPOSITORY=84`, consumer-set SHA-256 `015ed7d96a4579c84d170888151e44a36cf95192760555966ac47df0764ffb3a`.
- Executable ledger: Wave17 rebuild and independent validator PASS at `1,133` entries: `READ=504`, `MUTATION=629`, `DIRECT_PASS=33`, `STATIC_ONLY=1,018`, `BLOCKED_DYNAMIC=82`, missing/duplicate `0`; entry-set SHA-256 `775a00e4ef73f19361bab6d3a057984ffb4902a1afadc5167067edea7ce5a882`.
- Executable receipts: Wave16 immutable prefix `167` plus Wave17 `15` equals `182`. The three WBS776 SQL READ providers each pass exact output, wrong environment, wrong operation, tamper, and child-process restart scenarios with `READ_ONLY` and `DML=0`; evidence commit is `5e8495e241edce5230a69e96f5372f29ade5a1de`.
- Transition/stable-ID correction: `node --import tsx --test test/object-db-consumer-stable-id.test.ts test/object-db-consumer-transition-contract.test.ts` — `23/23 PASS`. Six removed per-command pet-skill runtime identities remain reserved as tombstones; 1,101 registered active identities and 32 deterministic current identities cover all 1,133 current consumers without ID reuse.
- Post-correction Gate7 focused set: transition, executable ledger, Wave17, stable ID, canonical shadow/readiness, WBS777 continuation, WBS778 certificate/receipt, and actual SHADOW ingress — `65/65 PASS`. The ledger suite rebuilds and revalidates all 1,133 entries rather than accepting the checked-in counts alone.
- ITEM remains `SHADOW_ONLY` and `ITEM_BAG_MODERN` remains pending. The historical Wave6 compare receipt is retained as immutable provenance but its changed source span keeps `sql-repository-3001ad9fc2f36d01` at `STATIC_ONLY`; it is not current DIRECT evidence.

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
- `runtime/src/inventory/maria-bag-repository.ts`, `legacy-bag-formatter.ts`, `bag-shadow-parity-provider.ts`: transitional legacy output and the historical Wave6 stack parity provider. Its old receipt is preserved but not promoted after the current source span changed.
- `runtime/src/inventory/canonical-item-bag-shadow-read-provider.ts`, `legacy-bag-owner-label-provider.ts`, `canonical-item-bag-import-readiness-provider.ts`: WBS776 corrected active-player/parity composition and three additive ITEM READ consumers with Wave17 `DIRECT_PASS` execution receipts.
- import contracts/tables: `data_migration_object_domain_import_runs`, `data_migration_object_domain_import_records`, `canonical_owned_item_stacks`, `canonical_item_definitions`.
- authority/read models: `guild_territory_start_scopes`, `guild_territory_wars`, `operation_notice_heads`, `configuration_values`, rank marker and guild rank projections.

## Proven / missing / uncertain

- Proven: SELECT-only canonical evaluator, exact resolved player-id binding, precise castle suppression authority, owner marker/rank formatting, operation notice source, stack parity, negative guards, registry-controlled SHADOW evaluation, SHADOW receipt replay across app/pool reconstruction, exact non-silent outbox cardinality one, silent outbox cardinality zero, replay outbox-integrity rejection, immediate HTTP callback count zero, unchanged fixture quantities, WBS777 zero-row/post-import continuation completeness, and WBS778 no-write rank/guild presentation side-effect certification.
- Deliberately not claimed: operational import provenance, an ITEM_BAG MODERN route, external DIRECT reply, process-level restart of the full service, operating database/JSON, real-room or network behavior, Gate 8, or `feature/prod` reflection.
- Uncertain and therefore fail-closed: any player whose typed V3 projection/baseline/continuation evidence is incomplete or duplicated, whose presentation snapshot drifts, or whose castle authority is not exactly one row.

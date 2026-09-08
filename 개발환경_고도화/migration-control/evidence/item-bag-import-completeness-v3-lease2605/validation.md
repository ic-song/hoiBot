# WBS777 item bag import completeness V3 validation

- Catalog: `SC-20260902-1`
- Lease: `슬라이스_선점!2605`, single `ACTIVE`
- Baseline: `81ee08fd63acccce20e025158f852c8d8e36d1e3`
- Database boundary: synthetic `hoibot_rehearsal_wbs777` on disposable MariaDB port `3331`; operational database and assets were not read or written.

## Gate evidence

1. Gate1: the existing per-stack receipt check cannot distinguish an empty bag from missing extraction and cannot bind an import-commit mutation baseline. Existing WBS776 consumer, readiness, bag-shadow and Wave17 evidence files remain unchanged.
2. Gate2: migration 488 adds `player_item_bag_import_completeness_projections` with CUID2 `CHAR(8) ascii_bin` PK, exact player/import-run/staging-witness FKs, four candidate keys, count/hash/version/revision/KST checks, and four audit columns. Rollback refuses while projection rows exist.
3. Gate3: the V3 profile requires exactly one `BAG_CONTAINER` staging witness per player, including `{}`; its catalog decision is `IGNORE/NOT_OBJECT_DOMAIN_INPUT/0`, while `ITEM_STACK` siblings alone contribute completeness counts. Synthetic zero-source baseline is explicitly eligible.
4. Gate4: `MariaObjectDomainImporter` creates the baseline after target rows and receipts but before `run_status='COMPLETE'`, exact-replays it with zero writes, fails closed on witness/state drift, and deletes it before reverse target rollback.
5. Gate5: the disposable MariaDB test accepted `expected_source_key_count=0`, `projected_stack_count=0`, ledger count 0, verified all FKs/checks, and rejected a second active projection.
6. Gate6: the focused suite verifies semantic profile/contract hashes, frozen 47-target V2 base preservation, zero-source build/replay/tamper failure, migration/manifest/schema-plan/additive-plan registration, and rollback ordering. Baseline stack/ledger hashes are import-commit anchors only: future readiness must validate ledger prefix/continuity plus current final balances, never `current == baseline`. Frozen PET-EQUIPMENT remains consumer actual-read validation and is not claimed by this projection.

## Commands and results

- `node --import tsx --test test/item-bag-import-completeness-v3.test.ts`: `6/6 PASS`
- `npm run typecheck`: `PASS`
- disposable MariaDB 11.4, port 3331, `RUN_ITEM_BAG_COMPLETENESS_MARIADB_INTEGRATION=true node --import tsx --test test/item-bag-import-completeness-v3-mariadb.integration.test.ts`: `1/1 PASS`
- JSON parse for all new/modified contracts: `PASS`
- `git diff --check`: `PASS`

## Known baseline failures outside this lease

The pre-existing V1/V2 object-model semantic hashes in baseline `81ee08fd` are stale against the baseline object-model contract: `object-domain-import-profile-v2.test.ts` expects `d73f1ed...` but calculates `7af153...`; the V1 suite similarly reports pre-existing component contract drift. The WBS777 V3 hashes are current and pass. This lease does not rewrite V1/V2 contracts or applied migrations.

## Sealed file hashes

- migration 488: `932e7634543a18b6aeeed5ac1881aa94bb765721fa90a598efe5cd8c60290734`
- rollback 488: `4f9d955260e07400e7a56ea6918936e03ccbb73dbd281972db9abf26d51f3b0b`
- V3 profile bytes: `416e1352fbf8eabe5c6205eb1f5cf8d3539100da8d58b96dd20a37c73ed6de60`
- V3 contract bytes: `53f8668b84eaac86ca5d11a2d03c7a5051d6226e1dd871ec7dcac0fcbbb9e46b`
- profile semantic SHA-256: `7c7ba299c2b1bc87a370fa447e4a976d2987b00405a1a793b1997b12772cec32`
- import contract semantic SHA-256: `a88ae67a230702e60a7c3ba2870579da933d9e4bfd2df93ef7fc1ac7c3b55e77`

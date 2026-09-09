# SL-ASSET-ITEM-RESTRICTION-OCCURRENCE-CATALOG-01 Gate 1~7 evidence

- Lease: `2459`
- Execution: `개발자-SL-ASSET-ITEM-RESTRICTION-OCCURRENCE-CATALOG-01-20260901T034544`
- Catalog version: `ASSET-FREEZE-v2.435-item-restriction-occurrence-01`
- Baseline: `906f4cff55cf45f6ec992f09eb21085ef6289a77`
- Classification evidence: `0a9098e4c451c8d3e4802649e45ee73fcc84c32c` (cherry-picked as `a4daec61`)
- Source revision: `5925b83b1dbfb78ef583354604e112b9430003f3`
- Source SHA-256: `b6f4751f2faf7588c2e41c032bac4fc5b05ff6bd2c105ea0c57a0e072c60c402`

## Gate 1 source verification

The assigned baseline contains an older `data/itemList.json` projection with `544/538` `nonItems` rows/unique values and `377/376` `untradableList` rows/unique values. The approved classification source revision contains the authoritative frozen `674/670` and `504/503` rows. The generator reads the exact Git object at the approved revision and refuses a source hash or count mismatch; it does not replace or edit the baseline or operational JSON.

## Gate 2 mapping

- `asset_item_restriction_sets`: immutable source/version and policy-kind boundary.
- `asset_item_restriction_definitions`: one definition per binary source value inside a set, with nullable verified canonical item FK.
- `asset_item_restriction_occurrences`: every one-based ordered source occurrence, including duplicates.
- Existing `item_restrictions`, command consumers, item ownership, package catalog, object catalog and ledger tables remain unchanged.

## Gate 3 fixture

- Sets: `2`
- Definitions: `1,173`
- Occurrences: `1,178`
- Duplicate-name groups: `5`
- `nonItems`: `674` rows / `670` definitions
- `untradableList`: `504` rows / `503` definitions

## Gate 4~7 validation

- Focused Node tests: `7/7 PASS`
- TypeScript typecheck: `PASS`
- TypeScript build: `PASS`
- Fresh isolated MariaDB migrations: `405 applied`, including migration 418
- Migration 418 direct reapply: `PASS`
- Rollback: all three new tables removed (`table count 0`)
- Replay after rollback: `PASS`
- Provider parity and protected projection probe: `6/6 PASS`
- Restart/reconnect: `PASS`
- Shadow: `1,178/1,178 PASS`, existing consumer cutover false
- Full regression: `1,366 total / 1,359 pass / 0 fail / 7 skip`

## Safety boundary

- No legacy `main.js`, `Info.js`, or `data/*` edit.
- No existing `item_restrictions` consumer cutover or mutation.
- No inventory, ownership, package, object catalog, or ledger mutation.
- No feature/prod or operational database change.
- Gate 8 remains false.

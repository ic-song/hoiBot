# SL-ASSET-MINIPET-COLLECTION-REWARD-CATALOG-01 validation

- Original lease: `2462` (`EXPIRED`, history preserved)
- Recovery lease: `2465`
- Execution: `개발자-SL-ASSET-MINIPET-COLLECTION-REWARD-CATALOG-01-RECOVERY-202609011402`
- Catalog version: `ASSET-FREEZE-v2.435-mini-pet-collection-reward-01`
- Baseline: `d7b7485b3996b32be67502954cac9a582b4dd928`
- Approved source revision: `5925b83b1dbfb78ef583354604e112b9430003f3`
- Working-file SHA-256: `3dadafd107bb82480d6d5218f98af2a31d0037af7c15b5fecaf8d3c62b9a4e39`
- Git-object SHA-256: `9d2d94abe3bfbbf0276f74e7ea2ffd2fb6242ba8a71b2a5af586d94cf4fdea2e`

## Completed evidence

- Source semantic parity: `8` grade rewards, `100` stage rewards and `100` stage title rows.
- Ordered reward occurrences: `108`.
- Canonical reward target: `pet_food` / `item.direct_bag.3076ae479a9eb44e` / `STACK`.
- Stable title bindings: `0`; unresolved title source bindings isolated: `100`; display-name-only matching: `0`.
- Focused tests: `7/7 PASS`.
- TypeScript typecheck and build: `PASS`.
- Fresh isolated MariaDB migrations: `406 applied`, including migration 420.
- Migration 420 direct reapply: `PASS`.
- Provider probe: `6/6 PASS`.
- Shadow parity: `108/108 PASS`.
- Narrow rollback removed both catalog tables; replay restored `1` catalog and `108` occurrences.
- Dedicated MariaDB restart and reconnect: provider `6/6 PASS`, Shadow `108/108 PASS` after restart.
- Full regression: `1373` tests, `1366` pass, `0` fail, `7` environment-dependent skips.
- Final focused tests: `7/7 PASS`; TypeScript typecheck and build: `PASS`.
- Gate 1 through Gate 7 are ready to close; Gate 8 remains false.

## Safety boundary

- No reward consumer cutover.
- No canonical item/title definition or ownership mutation.
- No legacy `main.js`, `Info.js`, or `data/*` edit.
- No feature/prod or operational database change.
- Gate 8 remains false.

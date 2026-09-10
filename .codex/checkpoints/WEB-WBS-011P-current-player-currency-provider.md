# WEB-WBS-011P checkpoint

- Slice: `SL-COMMON-CURRENCY-CURRENT-BALANCE-READ-PROVIDER-01`
- Lease: `Lease2645`
- Baseline: `ef049e9d19ff97c60d85af58cea2f45a0defb3aa`
- Implementation: `f00f679d5e18ad7a19de962c2fc2e7f3f5026211`
- Catalog / delta / evidence schema: `SC-20260902-1` / `SCD-WEB-20260910-8` / `web-current-player-currency-provider-v1`
- State: Gate 1~6 complete, independent Gate 7 pending, Gate 8 false

The existing `/api/v1/player-profiles/current` interface is reused. The profile and session provider contracts now enforce active, undeleted owners and active currency definitions while preserving all balance, version, and player identifiers as strings. No new provider, route, schema, migration, or mutation was created.

Validation: focused 13/13, typecheck PASS, build PASS, diff-check PASS, changed SQL DML 0. Evidence is under `개발환경_고도화/migration-control/evidence/web-current-player-currency-provider-20260910`.

Next: independent High review. After Gate 7 GO, release this provider Lease and start the Medium `/account/currencies` UI consumer Lease.

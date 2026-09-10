# WEB-WBS-011P existing provider contract validation

- Lease: `Lease2645`
- Catalog: `SC-20260902-1`
- Delta: `SCD-WEB-20260910-8`
- Evidence schema: `web-current-player-currency-provider-v1`
- Implementation: `f00f679d5e18ad7a19de962c2fc2e7f3f5026211`
- Risk/tier: shared authentication and profile read contract, `T2 High`

The current profile API remains the single read interface. The change adds no provider class and no route. The profile repository now excludes soft-deleted players and currency accounts whose definition is inactive. Login and current-session authentication exclude soft-deleted user accounts.

The focused run passed 13 of 13 tests. It verifies authenticated-session self scope even when a different player ID is supplied in the query string, exact string round trips for `DECIMAL(30,3)` values above JavaScript's safe integer range, unsigned BIGINT IDs and versions, active currency definition filtering, and the soft-deleted account predicate. Existing admin currency profile and account recovery regressions also pass.

`npm run typecheck`, `npm run build`, and `git diff --check` passed. The changed runtime SQL adds only read predicates and an inner join; mutation DML added by this slice is zero. Gate 7 remains pending for an independent reviewer. Gate 8 and all production resources remain untouched.

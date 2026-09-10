# WEB-WBS-011P independent Gate 7 review

- Review target: `WEB-WBS-011P` / `SL-COMMON-CURRENCY-CURRENT-BALANCE-READ-PROVIDER-01`
- Lease: `Lease2645`
- Implementation commit: `f00f679d5e18ad7a19de962c2fc2e7f3f5026211`
- Evidence commit: `48a0ed0d0721ce91c2dfbd96476ec22bb2e45d45`
- Reviewer independence: the reviewer did not own or author the implementation or submitted evidence.
- Decision: **Gate 7 GO**
- Findings: **P0 0 / P1 0 / P2 2**
- Gate 8: `FALSE`; production DB/data and `feature/prod` remain outside this review.

## Independent verification

The implementation commit is the direct child of the assigned baseline `ef049e9d19ff97c60d85af58cea2f45a0defb3aa`; the evidence commit is its direct child. `HEAD`, local `feature/web-portal`, and `origin/feature/web-portal` were all `48a0ed0d0721ce91c2dfbd96476ec22bb2e45d45` at review time. The three submitted file hashes exactly match `summary.json`.

The implementation changes only the three claimed runtime/test files. It adds no route, provider class, migration, schema, or application entrypoint change. Added SQL consists of `SELECT` predicates and an inner join; independent diff inspection found no added DML or DDL token. `git diff --check` passed for both the implementation and evidence commits.

The live Lease row `슬라이스_선점!2645` claims read access to the existing route/profile/schema inputs and write access to exactly the two implementation files, the focused test, checkpoint, evidence directory, and `WEB-WBS-011P`. The target diff stays within that scope. The other live claim found beside it (`Lease2646`) records no overlap, and its resources do not intersect these writes.

Contract checks:

- Current-player self scope: `/api/v1/player-profiles/current` resolves only `refreshSession(...).session.playerId`; a query-string `playerId` override is ignored by the independent test.
- Active, undeleted owners: profile reads require `p.status = 'active' AND p.deleted_at IS NULL`; login/session authentication requires a non-deleted user account, and current-session authentication also requires `status = 'active'`.
- Allowed currencies: the currency read uses an inner join on `currency_definitions.code` with `definition.active = TRUE`, excluding inactive or missing definitions.
- Lossless numeric transport: schema inspection confirms `currency_accounts.balance DECIMAL(30,3)`, `players.id BIGINT UNSIGNED`, and account/profile versions as unsigned BIGINT. The MariaDB pool explicitly sets `decimalAsNumber: false`, `bigIntAsNumber: false`, and `insertIdAsNumber: false`; repository/DTO conversion keeps IDs, balances, and versions as strings. The focused route replay preserved `999999999999999999999999999.999`, `9223372036854775807`, and `18446744073709551615` exactly.
- Regression surface: legacy `currencies` map and ordered `currencyAccounts` remain available. Focused admin currency/profile and account-recovery tests passed, followed by broader user-auth, legacy profile, admin shell, reward-currency, and balance read/consumer regressions.

## Independent runs

- Focused contract/regression: `13/13 PASS`
- Broader admin/profile/auth regression: `49/49 PASS`
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`
- Implementation/evidence `git diff --check`: `PASS`
- Submitted SHA-256 manifest: `3/3 exact`
- Changed SQL DML/DDL: `0`

## Findings

### P2 — inactive-definition and numeric round-trip lack a real MariaDB execution

The focused test verifies the SQL join text using a fake database and verifies the HTTP string payload with an injected profile. It does not insert an inactive currency definition and boundary values into a disposable MariaDB instance and execute the real repository query. The SQL, schema, connector settings, and serialization chain are internally consistent, so this is an evidence-depth gap rather than a demonstrated defect. Add a synthetic MariaDB integration case when the next shared-provider/consumer Shadow run is assembled.

### P2 — submitted CONTROL reference is stale

`summary.json` records `슬라이스_보고수신!5678 ACTIVE`. Live read shows that control is superseded; the current non-superseded authority at review time is `슬라이스_보고수신!5681 ACTIVE`, which still lists `Lease2645 ACTIVE` and the same catalog/delta/evidence schema. This does not change the claim or implementation result, but the Gate 7 report should cite the current authority instead of treating row 5678 as active.

## Gate 7 conclusion

No P0 or P1 defect was found. Self scope, active/undeleted account and player boundaries, active-currency filtering, lossless DECIMAL/BIGINT handling, compatibility regressions, DML0, Git lineage, hashes, and claim scope are supported by independent source inspection and passing replay/build checks. Gate 7 is **GO** with the two P2 follow-ups above. Gate 8 remains out of scope.

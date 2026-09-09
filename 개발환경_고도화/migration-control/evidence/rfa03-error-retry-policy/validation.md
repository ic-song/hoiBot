# RFA-03 validation

- focused unit/compatibility: `63/63 PASS`
- isolated Maria code/errno: `2/2 PASS`
  - actual `ER_DUP_ENTRY` / `1062` from primary and business UNIQUE violations
  - actual `ER_NO_REFERENCED_ROW_2` / `1452` from an FK violation
  - Maria server `SIGNAL` produced `ER_LOCK_DEADLOCK` / `1213` and `ER_LOCK_WAIT_TIMEOUT` / `1205`; both retried only through a fresh transaction invocation
- actual `createScopedDatabaseClient` path propagated Maria 1213/1205 unchanged without entering its savepoint implementation
- root/scoped boundary, distinct transaction objects, exact exhaustion cause identity, constraint-name spoof and hostile accessor/Proxy negatives: PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run object-data:validate`: PASS, registered objects `98`
- `git diff --check`: PASS
- full suite: intentionally not run; reserved for final T3 checkpoint

Focused command:

```text
node --import tsx --test test/maria-database-error-policy.test.ts test/object-identity-audit-provider.test.ts test/object-import-crosswalk-binding.test.ts test/request-reuse-contract.test.ts test/transaction-receipt-outbox-contract.test.ts
```

Maria command used `RFA03_ERROR_RETRY_MARIADB_TEST=true` against a dedicated `rfa03_lease2564` database. The test tables and database were dropped after the run. No operational database or data was accessed.

# Wave2 source audit

- Lease/WBS: `2570` / `751 Wave2`
- Baseline: `1bb53e291d793c1842e069b96992150431467b48`
- Frozen manifest/ledger denominator: `1,111`; missing/duplicate/unknown IDs: `0/0/0`
- Before: `DIRECT_PASS=3`, `STATIC_ONLY=556`, `BLOCKED_DYNAMIC=552`, proven/unproven `3/1108`, registry mismatch `8` (all unattributed).
- Selected source-derived static READ consumers: `sql-repository-aa5b2d6d12d1268b` (`resolveLegacyObjectId`), `sql-repository-fd1e8659cff045f9` (`resolveAlias`), `sql-repository-520566e376bf7ee8` (`resolveSource`). Each has unresolved dynamic call count `0` and registry mismatch `0`.
- No schema, migration, shared production provider, `main.js`, `Info.js`, operational data, feature/prod, or Gate change.


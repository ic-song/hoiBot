# Wave6 source audit

- Lease/WBS/execution: `2574` / `751 Wave6` / `실행패리티하네스DB-SL-OBJECT-DB-EXECUTABLE-PARITY-HARNESS-01-WAVE6-202609061250`; baseline `a0c0045eb9f8e3cb92662a9580f09640b1f5ce14`.
- Before: frozen `1111`, proven/unproven `9/1102`, `DIRECT_PASS=9`, `STATIC_ONLY=550`, dynamic `552/790`, mismatch `8` unattributed, receipts `45`.
- Initial stable single-query audit: unproven `READ` + unresolved dynamic `0` was `265`; source-span query sites were `0 queries=57`, `1 query=0`, `2 queries=1`, `4 queries=1`. Therefore the requested single-query eligible cohort was exactly `0` and no consumer was promoted under that contract.
- With explicit scope expansion, selected both remaining non-overlapping `SQL_REPOSITORY` reads: `sql-repository-7367fce7053551f3` (`MariaPlayerContextProvider.resolveSelf`, one-query active branch/two-query fallback) and `sql-repository-3001ad9fc2f36d01` (`BagShadowParityProvider.compare`, four ordered queries).
- Both source spans and hashes match the frozen manifest, use actual committed TypeScript, have no DML/transaction, and were not previously proven.

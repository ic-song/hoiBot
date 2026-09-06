# Wave4 source audit

- Lease/WBS/execution: `2572` / `751 Wave4` / `실행패리티하네스DB-SL-OBJECT-DB-EXECUTABLE-PARITY-HARNESS-01-WAVE4-202609061135`; baseline `fffcb5fa592aeabee588ffdc1e7d51ff8f123f39`.
- Before: frozen `1111`, proven/unproven `7/1104`, `DIRECT_PASS=7`, `STATIC_ONLY=552`, dynamic `552/790`, mismatch `8` unattributed.
- Selected only `sql-repository-9cfe67ded7b1e5b0` (`PetTitleCanonicalReadProvider.listOwned`): source-derived `READ`, `CURRENT_SQL`, unresolved dynamic `0`, non-overlap with Wave1~3.
- Multi-query/fallback and broad consumer candidates were excluded to preserve the stable single-query harness contract.

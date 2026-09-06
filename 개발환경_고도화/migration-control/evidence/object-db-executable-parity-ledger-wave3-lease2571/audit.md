# Wave3 source audit

- Lease/WBS: `2571` / `751 Wave3`; baseline `9dbd9de6fd7a47e7ed0a6dd337692aa6f60807f8`.
- Before: frozen `1111`, proven/unproven `6/1105`, `DIRECT_PASS=6`, `STATIC_ONLY=553`, dynamic `552/790`, mismatch `8` unattributed.
- Selected only `sql-repository-261eb97022941f77` (`MariaPlayerContextProvider.resolveUniqueLegacyDisplayTarget`): source-derived `READ`, `CURRENT_SQL`, unresolved dynamic `0`, non-overlap with Wave1/2.
- The two-query `resolveSelf` was excluded to avoid widening the stable single-query harness contract.


# Wave5 source audit

- Lease/WBS/execution: `2573` / `751 Wave5` / `실행패리티하네스DB-SL-OBJECT-DB-EXECUTABLE-PARITY-HARNESS-01-WAVE5-202609061211`; baseline `1aa33df147a87338174411181074a86538d3c6ec`.
- Before: frozen `1111`, proven/unproven `8/1103`, `DIRECT_PASS=8`, `STATIC_ONLY=551`, dynamic `552/790`, mismatch `8` unattributed.
- Selected only `sql-repository-13888c58966b6d56` (`MariaCanonicalFurnitureHomeRepository.listPlacedFurniture`): source-derived `READ`, `CURRENT_SQL`, unresolved dynamic `0`, non-overlap with Wave1~4.
- Multi-query/fallback and broad consumer candidates were excluded to preserve the stable single-query harness contract.

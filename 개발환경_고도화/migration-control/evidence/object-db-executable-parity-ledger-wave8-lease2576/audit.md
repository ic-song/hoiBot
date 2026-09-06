# Wave8 source audit

- Lease/WBS/execution: `2576` / `751 Wave8` / `실행패리티하네스DB-SL-OBJECT-DB-EXECUTABLE-PARITY-HARNESS-01-WAVE8-202609061601`; baseline `d1fe06720ddb294818553b8a8678b1223eccf654`.
- Before: frozen `1111`, proven/unproven `14/1097`, `DIRECT_PASS=14`, `STATIC_ONLY=545`, dynamic `552/790`, mismatch `8` unattributed, receipts `70`.
- Selected non-overlapping admin READ consumers: DataStatus `admin-command-0ab0acb6f570d48c`, PetOwnerRead `admin-command-115e33dcf567dd08`, RingRead `admin-command-3a76b9ad462b6143`, ServerStats `admin-command-5e04d0767d4c2abc`.
- Each proof binds the frozen `IrisAdminCommandService` dispatch span at verified ancestor `15abb95203e7eb375c9f0bd4294a0ec7100aa1a6` and the current guard, service, repository and dispatcher spans. The manifest classification base predates these offsets, so it was not misused as the span commit. The executable target invokes the actual committed TypeScript service path with an isolated synthetic database; no external reply or network is called.
- DataStatus and ServerStats retry owners were audited at their real Maria conflict points. Deadlock is injected at the operation lock read; ServerStats duplicate is injected at `INSERT INTO operations`. Every attempt records BEGIN, exact calls, ROLLBACK/COMMIT and committed state.
- RingRead still depends on the legacy `item_definitions.code` lookup. PetOwnerRead has a broad `FOR UPDATE` read set and no local deadlock retry. These are preserved source risks, not silently reinterpreted or fixed in this proof wave.
- No schema, migration, shared provider, `main.js`, `Info.js`, operational data, operational database, feature/prod, Gate7 or Gate8 change is included.

# WBS778 / Lease2606 validation

- `npm run typecheck`: PASS.
- Focused Node tests: 10/10 PASS; the object-model contract suite adds 25/25 PASS.
- `npm run build`: PASS.
- `npm run object-data:validate`: PASS, 114 registered tables.
- Legacy oracle: exact brace-extracted `checkRank`/`getMyGuildId`/`getMyGuildInfo` functions were executed in a VM. VALID and NONE produced zero `saveJsonFile` calls; current stale and lord stale produced one each; dual stale produced two. Exact guild-field deletion and all other member/data invariants were compared. Poison `petData` recorded zero property reads.
- Source drift: `checkRank`, `getMyGuildId`, `getMyGuildInfo`, and `generateBagOutput` hashes plus their ordered aggregate equal `4973477b937a33533381ef0f5bf9f256c46410e9aef2d02a0861531f5c9eb896`; the `/가방` branch anchor is also pinned.
- Identity: legacy player-key hashes bind only through the same import run's staging owner locator -> canonical-player import receipt; display name is never used as identity. Nickname change stays READY while wrong-player and ambiguous provenance fail closed.
- Tamper negatives: every certificate fingerprint, full certificate set, membership semantic hash, validation fingerprint, counts, RAW content, runtime source, and castle-lord evidence are recalculated or exactly rebound; other-member mutation and bogus 64-hex values fail closed.
- Replay/rollback: exact replay performs zero DML; drift is rejected; only inactive validation runs can be deleted; schema rollback refuses populated evidence.
- Isolated MariaDB 11.4 (`hoibot-wbs778-mariadb-final`, local disposable DB, removed after test): all 476 migrations through 489 applied; two WBS778 tables and five FKs verified; the full readiness SELECT parsed/executed and failed closed on empty evidence; server restart retained both tables; empty rollback removed both; migration489 reapplied successfully.
- DML0: readiness accepts only `AppWiringReadParticipant`, emits one SELECT, and tests reject any INSERT/UPDATE/DELETE/REPLACE token.

No operational JSON/database, live room, external send, WBS776 consumer, or WBS777 source was touched. Direct activation remains fail-closed until WBS776 explicitly injects this provider and Gate8 reseals the latest production snapshot.

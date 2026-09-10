# WEB-WBS-013A admin account-link read validation

- Lease: `Lease2649`; slice: `SL-ACCOUNT-ADMIN-WEB-LINK-READ-01`.
- Delta/schema: `SCD-WEB-20260910-11` / `web-admin-account-link-read-v1`.
- Route: `GET /api/v1/admin/players/:playerId/account-links`.
- Focused command: `node --import tsx --test test/admin-account-link-read.test.ts` — 4 passed, 0 failed, 0 skipped.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- The focused DML contract records two `SELECT` statements only and rejects `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `ALTER`, `CREATE`, and `DROP`.
- Existing administrator session authentication and `player.read` permission are required before the reader runs. The route accepts a lossless decimal `uint64` player ID, reports an absent player as 404, and reports an existing unlinked player with an empty success array.
- The response exposes only opaque portal/link identifiers and masked login/external identifiers. It does not return `identity_scope_key`, verification challenge data, or session data.

## Handoff

This backend subclaim is `HANDOFF_READY`. The admin shell UI consumer and independent Gate 7 review remain pending; Gate 7 and Gate 8 are not claimed here.

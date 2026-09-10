# WEB-WBS-011C current-player bag category provider checkpoint

- Mode: `WEB_PORTAL` shared read provider
- Slice / Lease: `SL-ITEM-USER-WEB-BAG-CATEGORY-READ-01` / `Lease2651`
- Catalog delta / evidence schema: `SCD-WEB-20260910-12` / `web-current-player-bag-category-provider-v1`
- Worktree / branch: `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909` / `feature/web-portal`
- Provider commit: `eb542f2f140b7a8875cd6886de5756d6b066f2cb`
- Evidence: `개발환경_고도화/migration-control/evidence/web-current-player-bag-category-provider-20260910/`

## Completed scope

- Extended only `GET /api/v1/inventory/current` with optional `category=general|furniture`.
- Omitted category and `general` preserve the existing general response, sort, and pagination.
- `furniture` uses the session current player, active/undeleted player guard, and read-only bag-instance query. It filters `status='bag'` and preserves `/가구가방` order: charm descending, display name, stable instance ID.
- Furniture items retain `displayName` and `quantity: "1"` and add `charm` and `gradeDisplayName`; the response discriminant is `category: "furniture"`. No player or database stable identifiers are exposed.
- No transaction, outbox command service, UI, app wiring, admin, schema/migration, legacy source/data, `feature/prod`, or WBS Sheet was changed.

## Validation and gates

- Focused provider/route tests: `17/17 PASS`.
- `npm.cmd run typecheck`, `npm.cmd run build`, and `git diff --check`: `PASS`.
- Scripted read path uses `SELECT` only; DML, transactions, and outbox calls fail the fixture/source contract.
- Gates 1 through 6: evidence prepared. Gate 7: `FALSE`, independent review and actual UI Shadow pending. Gate 8: `FALSE`, out of scope.

## Next action and risk

`HANDOFF_READY`: an independent reviewer must inspect this provider and perform a real UI consumer Shadow before Gate 7. The existing user shell has not been changed to request `category=furniture`; a later consumer should preserve its no-category request and use the explicit category only for a dedicated furniture view.

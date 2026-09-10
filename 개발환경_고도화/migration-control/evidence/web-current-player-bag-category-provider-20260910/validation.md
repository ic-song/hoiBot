# WEB-WBS-011C current-player bag category provider validation

- 실행 ID: `WEB-WBS-011C-current-player-bag-category-provider-20260910`
- Lease / slice: `Lease2651` / `SL-ITEM-USER-WEB-BAG-CATEGORY-READ-01`
- catalog delta / evidence schema: `SCD-WEB-20260910-12` / `web-current-player-bag-category-provider-v1`
- provider commit: `eb542f2f140b7a8875cd6886de5756d6b066f2cb`
- execution profile/tier: `SHARED_PROVIDER` / `T2`

## Read contract

- `GET /api/v1/inventory/current` without `category`, and `category=general`, retain the existing general-bag response and legacy sorting/pagination exactly.
- Only `general` and `furniture` are accepted. Any other value returns `BAG_CATEGORY_INVALID` with HTTP 422.
- `category=furniture` is limited to the refreshed session's current `player_id`. The repository first requires an active, undeleted player with a profile.
- The furniture projection is a read-only `SELECT` from `furniture_inventory_instances` joined to `furniture_definitions`, filters `instance.status = 'bag'`, and uses `instance.charm_snapshot DESC`, display name, then stable instance ID as its order.
- The furniture response adds the stable `category: "furniture"` discriminant. Every item keeps `displayName` and string `quantity: "1"` for existing list consumers, then exposes only string `charm` and `gradeDisplayName`. Player and stable database IDs are not exposed.
- Existing furniture-bag capacity/header data is not added because the current web read contract has no authoritative capacity/header projection and it would require unrelated policy/home/pass reads.

## Focused verification

```text
node --import tsx --test test/current-player-bag.test.ts test/current-player-bag-web-routes.test.ts
tests 17, pass 17, fail 0

npm.cmd run typecheck
PASS

npm.cmd run build
PASS

git diff --check
PASS
```

- Fixtures verify omitted/general exact parity; furniture first, middle, and last pagination; stable same-input order; empty bag; excluded `placed`/`sold` fixture rows; unavailable/inactive player; expired session; invalid/unknown category; and uint64 charm/quantity string preservation.
- Scripted database fixtures reject `execute` and `withTransaction`; all recorded SQL begins with `SELECT`. Source checks find no DML, transaction, or outbox use in the provider implementation.

## Gate evidence and handoff

- Gate 1: current general contract, `/가구가방` lifecycle SELECT/order, and existing UI compatibility were re-verified.
- Gate 2: session scope, active/undeleted guard, status filter, response discriminant, and decimal-string boundary are fixed in the provider contract.
- Gate 3: focused synthetic fixtures cover the read/error boundary and non-bag status exclusion.
- Gate 4: category-aware service, MariaDB projection, and optional route query are implemented.
- Gate 5: Fastify route, auth refresh, service, and concrete repository are exercised together.
- Gate 6: general parity and verified furniture same-input ordering are covered by focused tests.
- Gate 7: `NO-GO`; a reviewer who did not author this evidence must complete independent review and actual UI consumer Shadow.
- Gate 8: out of scope; no production data, migration, or operational readiness work was performed.

Handoff state: `HANDOFF_READY` for independent Gate 7 review and UI Shadow only.

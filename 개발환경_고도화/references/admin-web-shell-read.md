# Admin Web Shell Read Slice

## Scope

- Slice: `SL-COMMON-ADMIN-WEB-SHELL-READ-01`
- Execution: `개발자-SL-COMMON-ADMIN-WEB-SHELL-READ-01-20260830T0546`
- Baseline: `79d3b18e`
- Runtime: Node.js 24, TypeScript, Fastify 5, same-origin browser client
- Gates in this slice: Gate 1 through Gate 7
- Gate 8: intentionally incomplete

This slice adds a read-oriented administrator web shell over the existing administrator session and directory APIs. It does not add or alter MariaDB schema, legacy Rhino commands, account actions, currency or reward actions, catalog editing, backup or restore behavior, production branches, or production data.

## Gate 1 Current-State Findings

The runtime already registers administrator REST routes through `registerAdminRoutes` in `src/app.ts`. No browser-facing HTML, CSS, JavaScript, static-file plugin, or frontend package currently exists.

The existing session contract is:

- `POST /api/v1/admin/sessions`: creates an HttpOnly, SameSite=Strict session cookie and returns the session, role codes, permissions, and a CSRF token.
- `GET /api/v1/admin/sessions/current`: restores the current session from the cookie.
- `DELETE /api/v1/admin/sessions/current`: requires the original CSRF token.

The web shell must keep the CSRF token in `sessionStorage`. The token is required only for logout in this read-only slice. No mutation API is exposed by the navigation or page controls.

The permission-gated views are:

| View | Permission | Existing API |
|---|---|---|
| Operations dashboard | `overview.read` | `/api/v1/admin/overview` |
| Player search and detail | `player.read` | `/api/v1/admin/players`, `/api/v1/admin/players/:playerId` |
| Audit trail | `audit.read` | `/api/v1/admin/audit-entries` |
| Channel activity | `activity.read` | `/api/v1/admin/channel-activity` |
| Moderation incidents | `incident.read` | `/api/v1/admin/moderation-incidents` |
| Monitoring events and delivery failures | `monitoring.read` | `/api/v1/admin/monitoring-events`, `/api/v1/admin/delivery-failures` |

The dashboard overview endpoint currently expires stale restrictions before calculating counts. This slice does not invoke it during automated or Shadow validation against operational data, and Gate 8 remains incomplete. A future server-side maintenance/read separation should be handled as its own provider change rather than hidden inside the web client.

## Gate 2 UI and API Contract

The web shell is served by Fastify at `/admin` and uses only same-origin fetch requests. It provides:

1. A login state with explicit invalid-credential, locked-account, and generic error handling.
2. A permission-aware navigation that omits unavailable views instead of presenting disabled action controls.
3. A dashboard showing only overview values returned by the existing API.
4. A searchable, paginated player list and read-only detail panel.
5. Paginated audit records.
6. Read-only monitoring panels for channel activity, moderation incidents, monitoring events, and delivery failures.
7. Loading, empty, unauthorized, expired-session, and retry states.

The browser client never calls `POST`, `PUT`, or `DELETE` administration resources except session creation and CSRF-protected session deletion. Player detail may contain currency, pass, guild, pet, home, rank, and badge information, but the web shell renders those values without edit controls.

## Conflict Boundary

The concurrent asset-catalog W5 worktree had no changed files at Gate 1 verification. This slice will not touch item, package, reward, inventory, catalog, schema, migration, or provider files. Its intended source changes are limited to new administrator web shell files, a minimal registration line in `src/app.ts`, focused tests, and migration evidence/checkpoint documentation.

# MariaDB Connectivity Validation

Validation date: 2026-08-03

## Scope

This record covers the actual hoiBot Server MariaDB foundation on the development PC. It contains no passwords, tokens, account identifiers, room identifiers, production JSON values, or database dump data.

## Runtime

| Component | Verified value |
| --- | --- |
| Container image | Official `mariadb:11.8.8`, pinned digest `sha256:efb4959...11890c4` |
| MariaDB runtime | `11.8.8-MariaDB-ubu2404` |
| Character set | `utf8mb4` |
| Collation | `utf8mb4_unicode_ci` |
| Host binding | Loopback-only `127.0.0.1:3307` |
| Persistence | Docker named volume `hoibot_mariadb_data` |
| Node connector | Official `mariadb` package `3.5.3` |

## Implemented Foundation

- Reproducible MariaDB Compose service and health check.
- Local-only ignored environment files and committed placeholders.
- Validated TypeScript configuration for host, port, user, password, database, pool size and timeout.
- MariaDB connection pool with string-safe BIGINT/DECIMAL handling.
- Database-aware server readiness.
- Checksum-validated ordered SQL migrations with a MariaDB advisory lock.
- Connection and transaction rollback probe.
- Restart persistence probe with cleanup.

## Applied Migration

`001_foundation.sql` created:

- `schema_migrations`
- `db_connection_probes`
- `event_inbox`
- `bot_users`
- `bot_rooms`
- `room_memberships`

One migration record exists. Re-running the migration applied no duplicate schema change and accepted the stored checksum.

## Actual Results

| Test | Result |
| --- | --- |
| Container health | PASS |
| Node.js `SELECT 1` through application credentials | PASS |
| Transaction insert followed by rollback | PASS; no row remained |
| Server readiness with MariaDB running | PASS; `200`, `database=ready` |
| Server readiness with MariaDB stopped | PASS; `503`, database unavailable |
| Readiness recovery after MariaDB start | PASS |
| Probe row persisted across MariaDB stop/start | PASS |
| Probe cleanup after persistence check | PASS; zero probe rows remained |
| Migration second run/idempotency | PASS |
| TypeScript type check | PASS |
| Unit tests | PASS; 15 tests after DB configuration coverage was added |
| Production-like Android JSON mutation | NOT PERFORMED |

## Current Limits

- No legacy game JSON has been imported.
- No game command reads or writes MariaDB yet.
- Backup and disposable restore validation are not implemented yet.
- The server currently runs as a Windows `node.exe` process while MariaDB runs in Docker Desktop; final Ubuntu/operation-PC placement remains open.
- MariaDB is a development foundation, not production reflection.

## Sources

- [MariaDB release model](https://mariadb.com/docs/release-notes/community-server/about/release-model)
- [MariaDB 11.8 LTS overview](https://mariadb.com/docs/release-notes/community-server/11.8/what-is-mariadb-118)
- [MariaDB Docker Official Image](https://hub.docker.com/_/mariadb/)

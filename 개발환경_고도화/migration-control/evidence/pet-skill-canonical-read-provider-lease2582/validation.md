# Wave14 validation

## Focused tests

`node --import tsx --test` was run only for:

- `canonical-pet-skill-read-provider-schema.test.ts`
- `canonical-pet-skill-read-provider.test.ts`
- `canonical-pet-skill-read-seed.test.ts`
- `maria-canonical-pet-skill-repository.test.ts`
- `object-data-model-contract.test.ts`
- `data-migration-object-domain-import.test.ts`

Result: `70/70 PASS`. `npm run typecheck`, `npm run build`, and `git diff --check` passed.

## Isolated MariaDB

- Temporary MariaDB 12.2 instance: `127.0.0.1:3330`, database `hoibot_wave14`.
- All migration files applied: `migration-count 469`, including migration 481.
- Forward schema: 2 support tables, 9 added definition columns, equipment check `1..40`.
- Empty rollback restored support-table count 0 and equipment check `1..30`; forward re-application restored `1..40`.
- A synthetic slot-40 row caused the normal migration driver's rollback query to fail with MariaDB `1242` before DDL. Both support tables and the `1..40` check remained present.
- Server restart preserved both support tables and the `1..40` check.
- The isolated process was stopped; external network calls and operational-data writes were zero.

## Review closure

- Independent review P1 slot-30 importer drift: corrected to `1..40` with 31/40 allow and 41 deny regression coverage.
- Independent review partial seed risk: seeder now recomputes and byte-compares the exact 93-row projection before opening its transaction; exact 93 crosswalk updates occur in one transaction.
- Documentation placement/typo findings were corrected. No command registry, app route, candidate predicate, outbox, or DIRECT ledger was changed.

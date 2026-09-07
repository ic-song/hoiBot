# Wave14 validation

## Focused tests

`node --import tsx --test` was run only for:

- `canonical-pet-skill-read-provider-schema.test.ts`
- `canonical-pet-skill-read-provider.test.ts`
- `canonical-pet-skill-read-seed.test.ts`
- `canonical-pet-skill-read-seed-mariadb.integration.test.ts` (isolated opt-in)
- `maria-canonical-pet-skill-repository.test.ts`
- `object-data-model-contract.test.ts`
- `data-migration-object-domain-import.test.ts`

Result: non-integration focused cohort `74/74 PASS`; isolated MariaDB seed cohort `1/1 PASS`. This includes full-tuple tamper and anti-extra negatives. `npm run typecheck`, `npm run build`, and `git diff --check` passed.

## Isolated MariaDB

- Temporary MariaDB 12.2 instance: `127.0.0.1:3330`, database `hoibot_wave14`.
- A fresh database applied all migration files: `migration-count 470`, including migrations 481 and 482.
- Forward schema: 2 support tables, 9 added definition columns, equipment check `1..40`.
- Empty rollback restored support-table count 0 and equipment check `1..30`; forward re-application restored `1..40`.
- A synthetic slot-40 row caused the normal migration driver's rollback query to fail with MariaDB `1242` before DDL. Both support tables and the `1..40` check remained present.
- The explicit `db:seed:canonical-pet-skill-read` path registered and semantically cross-checked all 93 definitions, then reconciled exactly 30 aliases and 4 policies. Counts rejected extras; the definition import fingerprint, name, description, grade, handler and normalized options were checked rather than name-only matching.
- A failure at the final crosswalk rolled back the preceding definition updates. Server restart preserved definitions93/imports93/aliases30/policies4 and `utf8mb4_bin` Korean grades.
- Migration 482 rollback rejected live non-ASCII grades with preflight error 1242 before charset narrowing.
- The isolated process was stopped; external network calls and operational-data writes were zero.

## Review closure

- Independent review P1 slot-30 importer drift: corrected to `1..40` with 31/40 allow and 41 deny regression coverage.
- Independent review partial seed risk: the legacy-only source SHA and an independent full canonical tuple/policy SHA are both pinned. Negative tests mutate definitionCode, handler, options, sourceKey/order and policy values. The seeder recomputes and byte-compares the exact 93-row projection before opening its transaction; exact 93 semantic crosswalk updates occur in one transaction.
- Provenance: baseline 90 is supplemented only by the separately frozen 3-row artifact `pet-skill-post-freeze-v2435.json`, whose `sourceRef` is `8f075b4ef249543563e3338e8f3dd32046344880`. The combined legacy source hash and full canonical tuple hash are listed in `checkpoint.md`.
- Documentation placement/typo findings were corrected. No command registry, app route, candidate predicate, outbox, or DIRECT ledger was changed.

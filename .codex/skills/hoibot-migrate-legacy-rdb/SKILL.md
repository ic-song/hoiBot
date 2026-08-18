---
name: hoibot-migrate-legacy-rdb
description: Migrate hoiBot MessengerBotR/Rhino commands and JSON persistence to the TypeScript hoiBot Server and MariaDB one functional slice at a time. Use for command inventory, legacy JSON field tracing, relational schema design, disposable trial imports, Application Service or repository ports, legacy-versus-new parity checks, reconciliation evidence, and final production JSON cutover planning or execution.
---

# hoiBot Legacy RDB Migration

Move one functional slice through the same evidence-gated loop. Preserve legacy output and behavior until an explicitly approved change says otherwise.

## Required context

1. Read `개발환경_고도화/DECISIONS.md`, then `개발환경_고도화/MEMORY.md`.
2. Read `COMMAND_INDEX.md` before broad command scanning, then verify every finding in `main.js`, `Info.js`, and helpers.
3. Read `references/slice-workflow.md` before starting a slice.
4. Read `references/evidence-schema.md` before creating or updating slice evidence.
5. Apply `hoibot-save-flow-guard` when the slice changes persisted data. Apply `hoibot-rhino-js-review` when legacy Rhino code is inspected or changed.

## Slice loop

Repeat these stages for each command domain. Do not combine unrelated domains merely because they share a JSON file.

1. **Investigate commands** — record exact guards, aliases, output branches, helpers, automatic jobs, JSON reads/writes, and DEV/PROD routing.
2. **Design the DB** — map fields to domain tables, keys, constraints, indexes, transaction boundaries, ledgers, and transitional JSON only where justified.
3. **Rehearse data migration** — checksum the immutable source snapshot, import into a disposable database, and reconcile counts, totals, ownership, relationships, anomalies, and repeat-run behavior.
4. **Port command logic** — use `Adapter -> Application Service -> Domain Policy -> Repository -> MariaDB`; load and save through repositories, not transport adapters.
5. **Compare results** — run identical fixtures against legacy and new logic. Compare exact text for reads and state deltas plus replies for mutations.
6. **Gate the slice** — keep mutation routing disabled until import, logic, parity, restart, and rollback evidence pass.
7. **Record evidence** — maintain one JSON evidence file per slice and validate it with `scripts/validate-slice-evidence.mjs`.

If a stage fails, repair that stage and repeat the slice loop. Do not compensate for a mismatch by weakening the comparator or silently normalizing legacy load failures.

## Non-negotiable gates

- Treat `data/*.json` and the final Android export as read-only source snapshots.
- Never test mutations against original snapshots or production MariaDB.
- Do not hard-code expected row counts from one dated snapshot. Derive expectations from the selected manifest and source snapshot.
- Preserve integers exactly; preserve external IDs as strings; report lossy conversions as anomalies.
- Require idempotent schema migration and explicitly define whether the data importer is replay-safe or single-use.
- For mutation slices, compare balances, item ownership, ledgers, audit rows, and reply text inside the same acceptance case.
- Keep legacy fallback available until the slice is verified; do not dual-write unless a reconciliation and conflict policy is explicitly approved.
- Final cutover requires a fresh snapshot, checksums, a Rhino write freeze, disposable rehearsal of the same artifact, backup/restore proof, reconciliation, smoke tests, and a named rollback boundary.
- Never call the whole migration complete while any `main.js` or `Info.js` command, helper-driven automatic flow, administrator path, or JSON save flow remains unclassified.

## Evidence validation

Run from this skill directory:

```powershell
node scripts/validate-slice-evidence.mjs <absolute-or-relative-evidence.json>
```

Use `node scripts/validate-slice-evidence.mjs --self-test` after changing the validator.

The validator checks evidence completeness, not business correctness. Re-run the actual importer, service tests, parity fixtures, and database probes before advancing a status.

## Skill iteration

When the same command, query, comparison, or reconciliation step is manually repeated twice, add or refine a deterministic script or checklist here. Test every added script and keep snapshot-specific facts in slice evidence, not in this skill.

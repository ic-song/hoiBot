# Functional slice workflow

## 1. Command investigation

- Start with `COMMAND_INDEX.md`; verify in `main.js` and `Info.js`.
- Search exact command text, aliases, output fragments, helper names, timers, and administrator variants.
- Record exact command guards and rejected suffix-text cases.
- Trace every read object, mutated object, load path, save path, and DEV/PROD resolver.
- Include helper-driven scheduled or automatic behavior that touches the same data.
- Report search keywords, uncertain areas, and possible duplicate logic.

## 2. Schema design

- Define the aggregate and transaction boundary before tables.
- Use internal numeric IDs for joins and separate external identity mappings.
- Define PK, UK, FK, check/domain constraints, indexes, precision, collation, and deletion policy.
- Use ledgers and audit rows for balances and ownership changes.
- Keep raw JSON only for lossless source evidence or genuinely variable metadata.
- Map every legacy source path to a target column, child row, anomaly, or explicit exclusion.

## 3. Trial migration

- Export or select an immutable snapshot and calculate checksums.
- Create a disposable database from the same migration set intended for production.
- Run a dry run, then apply to the disposable database.
- Re-run according to the declared importer replay policy.
- Reconcile at least: source records, target records, per-user totals, global totals, ownership, foreign keys, unresolved identities, conversion anomalies, and orphan rows.
- Save machine-readable results without secrets or personal message contents.

## 4. Logic port

- Keep Iris and HTTP adapters thin.
- Put orchestration in Application Services, rules in Domain Policies, and SQL in repositories.
- Use parameterized SQL and explicit transactions.
- Apply idempotency to externally retried commands.
- Keep read formatting separate from repository queries so legacy text can be golden-tested.

## 5. Parity

For read commands, compare exact output including line breaks, emojis, ordering, commas, `allsee`, and empty/null cases.

For mutations, compare accepted and rejected inputs, reply text, every changed balance and inventory record, ledger and audit effects, save/commit atomicity, duplicate event behavior, and concurrent command behavior where relevant.

Use anonymized fixtures covering normal, boundary, missing-related-data, malformed-source, unauthorized, insufficient-balance, full-capacity, retry, and restart cases as applicable.

## 6. Slice completion

A slice is `verified` only when trial import and parity both pass and remaining risks are explicit. A slice is `cutover_ready` only when freeze, final import, smoke, and rollback plans are recorded and no blocker remains.

After each slice, update command navigation documentation only when the actual command/helper/data flow changed.

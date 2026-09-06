# Wave3 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; only an additive `player-target-row` adapter was added.
- Executes the actual TypeScript provider through `tsx`; no duplicate provider or production wiring.
- Trusted-input commit: `97da47115df8efcb985eb1ea943d2515b49bb7b1`.
- Fixture, runner, target, provider source span and hashes are Git-ancestry attested by the strict validator.
- No schema, migration, shared production provider, `main.js`, `Info.js`, data snapshot, feature/prod, Gate, or operational DB change.

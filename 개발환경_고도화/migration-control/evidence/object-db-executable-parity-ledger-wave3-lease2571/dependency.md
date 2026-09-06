# Wave3 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; only an additive `player-target-row` adapter was added.
- Executes the actual TypeScript provider through `tsx`; no duplicate provider or production wiring.
- Trusted-input commit: `e18dd723fd222fa387b094cd2f656bfd9073468f`.
- Fixture, runner, target, provider source span and hashes are Git-ancestry attested by the strict validator.
- No schema, migration, shared production provider, `main.js`, `Info.js`, data snapshot, feature/prod, Gate, or operational DB change.


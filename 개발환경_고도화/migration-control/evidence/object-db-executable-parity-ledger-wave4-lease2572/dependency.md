# Wave4 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; only an additive `pet-title-read-row` adapter was added.
- Executes committed actual TypeScript `PetTitleCanonicalReadProvider.listOwned` through `tsx`; no duplicate provider or production wiring.
- Trusted-input commit: `fe38e21745b7a037525faff4785c8c9befdfbfda`.
- Fixture, runner, target, provider source span and hashes are Git-ancestry attested by the strict validator.
- No schema, migration, shared production provider, `main.js`, `Info.js`, data snapshot, feature/prod, Gate, or operational DB change.

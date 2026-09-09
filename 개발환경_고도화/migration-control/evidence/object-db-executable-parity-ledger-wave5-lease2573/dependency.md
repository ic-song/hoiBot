# Wave5 dependency and provenance

- Reuses `NODE_OBJECT_DB_PARITY_V1`; only an additive `placed-furniture-read-row` adapter was added.
- Executes committed actual TypeScript `MariaCanonicalFurnitureHomeRepository.listPlacedFurniture` through `tsx`; no duplicate provider or production wiring.
- Trusted-input commit: `3c724f52c257f87f50805ff0957ba9e0a59d0d96`.
- Fixture, runner, target, provider source span and hashes are Git-ancestry attested by the strict validator.
- No schema, migration, shared production provider, `main.js`, `Info.js`, data snapshot, feature/prod, Gate, or operational DB change.

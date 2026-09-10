# WEB-WBS-011A actual API integration validation

- Lease: `Lease2647`
- Catalog / delta / schema: `SC-20260902-1` / `SCD-WEB-20260910-9` / `web-current-player-bag-integration-v1`
- Carries: provider `SCD-WEB-20260910-5`, UI `SCD-WEB-20260910-7`
- Implementation: `b1e6e6986e041e6bdd258da9c27cdb4258dac372`

The Fastify application now registers `GET /api/v1/inventory/current` with the same `UserAuthService` instance as the existing user account routes. The route accepts no player selector and passes only the authenticated session player ID to `CurrentPlayerBagService` and `MariaBagRepository`.

The 25-test focused run covers first, middle, and last pages, an empty bag, missing or inactive player, expired session, invalid pagination, unsigned 64-bit quantity strings, the existing responsive UI consumer, and app registration. Concatenating the three API pages exactly matches `compareLegacyBagItems` over the same unsorted fixture. The response omits the player ID. Expired sessions stop before provider access.

Typecheck, build, and diff-check passed. All captured source-domain statements are reads and the scripted provider rejects execute/transaction calls, so source-domain DML is zero. Gate 7 awaits a reviewer independent from implementation and evidence authorship. Gate 8 and production resources were not touched.

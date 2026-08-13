# Hardcoded Configuration Inventory

Updated: 2026-08-06

## Classification Rules

| Class | Destination | Examples |
| --- | --- | --- |
| Shared enum/status/type/reason | `common_code_groups`, `common_codes` | provider, channel type, processing result, title scope |
| Domain definition with attributes/relations | dedicated catalog | items, currencies, skills, titles, pets, furniture, bosses, modes |
| Operator-adjustable rate/limit/reward | versioned configuration set | fees, probabilities, reward tables, daily limits |
| Machine/deployment value or secret | environment variable | host, port, filesystem path, token, credentials, endpoint |
| Algorithm/state transition | code plus tests | level formula, ranking priority, market state machine |

## Observed Sources

- `roomToServer`: migrate to `channels`, `game_servers`, and `channel_server_mappings`; never keep room IDs in tracked config.
- `GLOBAL_CONFIG.attendance`, `level`, `daily`, `fee`, `freeMarket`, `pet*`, `miniPet*`, `guildTerritory`, rewards/rates/limits: versioned configuration after validation.
- Item, pet skill, mini-pet, pendant, package, furniture and boss definitions: dedicated catalogs.
- Production/DEV Android paths and external endpoints: environment/deployment contract.
- Calculation formulas, ranking tie-breaking and badge priority: application domain code with golden tests.

Promotion from code to configuration is vertical and feature-scoped; no broad mechanical rewrite of `main.js` is permitted.

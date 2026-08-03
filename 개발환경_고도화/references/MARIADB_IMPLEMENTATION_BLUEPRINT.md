# MariaDB Implementation Blueprint

Updated: 2026-08-03

## Purpose

Define enough persistence architecture for a future Codex session to implement hoiBot Server with MariaDB without rediscovering the migration boundaries.

This is a design blueprint. No MariaDB instance, schema, driver, or migration tool has been implemented yet.

## Persistence Boundaries

```text
redroid KakaoTalk DB
- Read through Iris for message/event integration
- Never used as the hoiBot game database

hoiBot MariaDB
- Owns game and operation state
- Replaces Android JSON persistence incrementally
```

Do not copy the KakaoTalk database schema into MariaDB. Store only stable external identifiers and normalized fields required by hoiBot.

## Current JSON Persistence Inventory

Read-only exploration of `main.js`, `Info.js`, and `data/*.json` showed that mutations frequently span multiple files.

Most frequent save targets in `main.js`:

| Current path variable | Approximate static save-call sites | Working domain |
| --- | ---: | --- |
| `filePath` / `member.json` | 204 | Member core, balances, bag and general game state |
| `memberPetPath` | 76 | Member pets and mini-pet state |
| `guildPath` | 63 | Guild state |
| `homeDataFile` | 43 | Pet Sweet Home state |
| `petHomeActivityFile` | 29 | Home visits, social/activity state |
| `petSkillDataPath` | 23 | Pet skills |
| `memberTitlePath` | 19 | Member titles |
| `freeMarketPath` | 10 | Market listings/history |
| `petExplorePath` | 10 | Pet exploration state |
| `petTitlePath` | 10 | Pet titles |
| `currencyLogPath` | 9 | Currency history/aggregation |
| `trialTowerPath` | 8 | Trial Tower state |

The count is a static call-site count, not an execution-frequency measurement.

### Migration Domains

| Domain | Current JSON examples | Risk |
| --- | --- | --- |
| Identity and member core | `member.json`, `attendanceLight.json` | High: central dependency |
| Currency and inventory | `member.json`, `currencyLog.json`, `itemInfo.json`, `itemList.json` | High: transactional |
| Pets and skills | `member_pet.json`, `petSkillData.json`, `pet_title.json` | High: multi-file mutation |
| Mini pets and collections | `miniPetData.json`, `miniPet_title.json`, `miniPet_collection.json` | High |
| Guilds | `guildData.json` | High: shared concurrent state |
| Pet home/social | `petSweetHomeData.json`, `petSweetHomeInfo.json`, `petHomeComments.json`, activity/placed-furniture files | High: several related files |
| Market | `freeMarket.json` | Critical: ownership and currency transfer |
| Towers/events/ranks | tower, castle, punch, board files | Medium to high |
| Packages/config/catalogs | package, item, changelog, monitor config files | Low to medium |

## Recommended First Vertical Slice

Do not start with inventory trading, market, guild rewards, or pet-home mutation.

Start with:

1. Stable room/user identity mapping.
2. Import of a minimal member profile projection from a read-only JSON copy.
3. One read-only member lookup command.
4. Result comparison between legacy JSON and MariaDB.
5. One low-risk mutation only after the read path is proven.

The first mutation must affect one aggregate and one transaction. A command that currently saves several JSON files is not a suitable first mutation.

## Initial Schema Modules

Exact columns must be confirmed from the selected first command before migration files are written.

### Infrastructure

- `schema_migrations`: applied migration identifiers and timestamps.
- `event_inbox`: unique Iris event ID, received time, processing state and attempt metadata for idempotency.
- `command_audit`: command ID, actor/room internal IDs, outcome and timestamps; do not store unnecessary raw message bodies.

### Identity

- `bot_rooms`: internal key, external Kakao `chat_id` stored as text, status and timestamps.
- `bot_users`: internal key, external Kakao `user_id` stored as text, status and timestamps.
- `room_memberships`: room/user relation and migration-safe legacy identity reference where required.

External IDs must be treated as strings in Node.js to avoid JavaScript integer precision loss.

### Member Core

- `player_profiles`: one row per hoiBot player with version/timestamps.
- `legacy_identity_map`: temporary mapping from legacy JSON keys to internal user IDs; restrict and remove when no longer required.

### Currency and Inventory

- `currency_accounts`: balance by player and currency code.
- `currency_ledger`: immutable balance-change records with unique operation IDs.
- `item_catalog`: stable item code and catalog metadata.
- `inventory_items`: player/item quantity and row version.

### Later Domains

- Pet, pet-skill and title tables.
- Mini-pet and collection tables.
- Guild, guild-member and guild-resource tables.
- Home, furniture, comment and activity tables.
- Market listing, reservation and settlement tables.
- Tower/event participation and result tables.

## MariaDB Data Rules

- Use InnoDB for transactional tables.
- Use `utf8mb4` for Korean text and emoji.
- Store time in UTC and convert at application boundaries.
- Store external Kakao IDs as `VARCHAR`, not JavaScript numbers.
- Store currency and quantities as integer/decimal values with explicit bounds; never floating point.
- Use foreign keys, unique constraints and check/application validation for invariants.
- Add `created_at`, `updated_at`, and a version/revision field where concurrent updates matter.
- Keep JSON columns only for transitional or genuinely variable metadata, not as a replacement for domain modeling.
- Never silently initialize missing migrated data to empty/default state.

## Transaction and Concurrency Rules

1. One command/event gets one unique operation ID.
2. Insert/check `event_inbox` before applying a mutation.
3. Perform related balance, inventory, guild, home, or market changes in one MariaDB transaction.
4. Lock or version rows whose concurrent modification would lose data.
5. Write the audit/ledger record in the same transaction as the state change.
6. Send the Kakao reply only after commit.
7. On rollback, return a controlled failure and do not partially reply as success.
8. Do not reproduce the current multi-file partial-save risk in the database design.

## Repository Layer Contract

Command handlers must not contain raw connection management.

```text
Iris adapter
-> normalized event
-> command service
-> domain service
-> repository/transaction boundary
-> MariaDB
-> reply adapter
```

The MariaDB driver, query builder/ORM, and migration tool remain unconfirmed. Selection criteria:

- Node.js 24 and TypeScript support.
- MariaDB compatibility.
- Explicit transaction and connection-pool APIs.
- Parameterized queries.
- Deterministic migrations and rollback/repair guidance.
- Maintained typing without hiding SQL behavior.

## JSON Import Strategy

1. Take a read-only source snapshot and compute checksums.
2. Validate every source JSON file; preserve parse/missing-file failures.
3. Import into staging tables or a disposable database first.
4. Record source filename, checksum, import version and row counts.
5. Resolve legacy identity keys through an explicit mapping table.
6. Compare domain totals and selected anonymized invariants.
7. Repeat imports idempotently in development.
8. Rehearse a production cutover from a fresh snapshot.
9. Keep the source snapshot unchanged for rollback evidence.

Avoid long-term dual writes between JSON and MariaDB. Prefer a domain-by-domain cutover with a short maintenance window, verified import, read comparison, and explicit rollback point.

## Domain Migration Order

1. Infrastructure, migrations, health, pooled connection and idempotency.
2. Room/user identity mapping.
3. Static catalogs and configuration required by the first command.
4. Member-core read projection and one read-only command.
5. Member-core low-risk mutation.
6. Currency accounts and immutable ledger.
7. Inventory.
8. Pets, skills and titles.
9. Guilds.
10. Pet home/social state.
11. Towers/events/ranks.
12. Market and other multi-party transactions last.

## Required Tests Per Migrated Command

- Same valid input produces equivalent user-visible output.
- Invalid and suffix-appended command inputs remain rejected.
- Missing/invalid source data does not become empty data silently.
- DEV/test and production contexts remain isolated.
- Duplicate Iris delivery changes state once.
- Concurrent requests cannot create a negative balance or duplicate item.
- Transaction rollback leaves every related table unchanged.
- Restart preserves committed data.
- Backup/restore preserves row counts and critical invariants.
- Legacy JSON snapshots remain unmodified.

## First Implementation Task Definition

The next implementation task should produce only the MariaDB foundation:

1. Add reproducible MariaDB and server services under `개발환경_고도화/infra/`.
2. Add local-only environment configuration and startup validation.
3. Add a pooled server database connection.
4. Add a migration runner and the infrastructure/identity tables only.
5. Add database live/readiness checks that do not expose credentials.
6. Add an integration test that performs `SELECT 1` and a rolled-back test transaction.
7. Add backup and restore-verification commands.

Do not migrate production JSON or enable a game mutation command in this foundation task.

## Foundation Acceptance Criteria

- A clean home-PC environment can start server and MariaDB from repository-owned configuration.
- Server readiness fails when MariaDB is unavailable and recovers when it returns.
- Migrations apply exactly once and report their version.
- A test transaction rolls back without residue.
- MariaDB data persists across container restart.
- A logical backup restores into a disposable validation database.
- No secret, identifier or database dump is tracked by Git.
- Existing MessengerBot production JSON and behavior remain untouched.

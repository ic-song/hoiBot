# Legacy JSON to MariaDB Schema Design

Updated: 2026-08-04
Status: logical design baseline; physical DDL must be delivered domain by domain

## Purpose

Design an extensible MariaDB model from the current hoiBot JSON persistence without copying each JSON file into one table. The target model must support KakaoTalk through Iris, an admin website, Discord, and future external APIs through the same server services.

The source snapshots were inspected read-only. No legacy JSON file was modified.

## Design Principles

1. Use internal numeric keys for domain records and keep Kakao, Discord, and other provider IDs in a separate external-identity table.
2. Never use a mutable display name or the current legacy nickname key as the permanent player key.
3. Model stable business data with typed columns and foreign keys. Use JSON columns only for transitional source payloads or genuinely variable provider metadata.
4. Keep current state and immutable history separately when money, items, ownership, or operator actions are involved.
5. Apply one command with one operation ID in one MariaDB transaction.
6. Make duplicate Iris/API deliveries idempotent before changing game state.
7. Route the admin website, Discord, and external integrations through hoiBot Server APIs. They must not connect directly to MariaDB.
8. Preserve source import checksums, row counts, and unresolved identity mappings. Never silently create empty/default data for a missing or invalid legacy record.

## Why File-Per-Table Is Rejected

`member.json` contains member profiles, currencies, inventory, battle state, counters, ranks, shop/config data, and event state. Other commands update several files together, including member, pet, skill, guild, home, market, and currency-log files. Reproducing those file boundaries as tables would preserve the current coupling and partial-save risk.

The relational boundary is therefore a business aggregate, not a JSON filename.

## Target Module Map

```text
integration/identity
  -> player core
     -> currency and inventory
     -> pets, skills and titles
     -> guilds
     -> home and social
     -> events, towers and rankings
     -> market

admin website / Discord / Iris / external APIs
  -> application services
  -> repositories
  -> MariaDB transaction
  -> audit/ledger/outbox
```

## 1. Integration and Identity

### Core tables

| Table | Key columns | Purpose |
| --- | --- | --- |
| `players` | `id`, `status`, `version`, timestamps | Stable hoiBot player identity independent of platform |
| `external_identities` | `id`, nullable `player_id`, `provider_code`, `external_user_id`, `display_name`, timestamps | Kakao, Discord, admin, and future provider identities |
| `external_identity_names` | `external_identity_id`, `display_name`, `observed_at` | Optional display-name history for mapping investigations |
| `channels` | `id`, `provider_code`, `external_channel_id`, `channel_type`, timestamps | Kakao rooms, Discord channels, and future external channels |
| `channel_memberships` | `channel_id`, `external_identity_id`, `status`, timestamps | Provider membership state |
| `legacy_identity_map` | `source_file`, `legacy_key`, nullable `player_id`, `resolution_status`, `import_run_id` | Explicit mapping from nickname-based JSON keys |

### Constraints

- Unique: `(provider_code, external_user_id)` on `external_identities`.
- Unique: `(provider_code, external_channel_id)` on `channels`.
- External IDs are `VARCHAR`, never JavaScript numbers.
- A legacy nickname may map to no player until reviewed. Import must not guess when the mapping is ambiguous.
- Current foundation tables `bot_users`, `bot_rooms`, and `room_memberships` remain valid for Iris connectivity. A later migration can backfill the generalized identity tables before those foundation tables are retired or exposed through compatibility views.

## 2. Player Core and Feature State

| Table | Key columns | Purpose |
| --- | --- | --- |
| `player_profiles` | `player_id`, `joined_at`, `level`, `experience`, `rebirth_count`, `server_code`, `version` | Stable profile fields from `member.json.member[*]` |
| `counter_definitions` | `code`, `period_type`, limits/metadata | Allowed counters only; prevents arbitrary EAV data |
| `player_counters` | `player_id`, `counter_code`, `period_key`, `value`, `updated_at` | Daily, weekly, event, ticket, and usage counters |
| `flag_definitions` | `code`, metadata | Allowed Boolean feature flags |
| `player_flags` | `player_id`, `flag_code`, `value`, `updated_at` | Claimed/consent/feature flags |
| `player_memos` | `id`, `player_id`, `content`, author/audit columns | Operator-visible notes if the source meaning is confirmed |

The current misspelled aliases such as `bostercnt`, `rebirthnt`, `towerrCnt`, and similar one-off fields must be normalized during import through an explicit mapping rule. They must not become permanent columns.

## Common Codes, Domain Catalogs, and Hardcoded Configuration

The current code contains status strings, type names, grades, item/display keys, limits, rates, rewards, probability tables, feature flags, and runtime paths. They must not all be placed in one generic table.

### Classification

| Classification | Storage | Examples |
| --- | --- | --- |
| Shared classification code | `common_code_groups`, `common_codes` | provider, channel type, player status, processing status, operation reason, asset type, title scope |
| Rich domain definition | Dedicated catalog table | currencies, items, skills, mini pets, furniture, packages, bosses, game modes |
| Operator-adjustable balance/configuration | Versioned configuration tables | daily limits, fees, reward amounts, probability/grade tables, feature activation periods |
| Environment-specific value | Environment/secret configuration | host, port, filesystem path, credentials, tokens, external endpoints |
| Algorithm invariant | TypeScript source with tests | transaction order, validation formula, state-machine transition rules |

### Common-code tables

| Table | Key columns | Purpose |
| --- | --- | --- |
| `common_code_groups` | `group_code`, `name`, `active`, timestamps | Defines an allowed code namespace |
| `common_codes` | `group_code`, `code`, `display_name`, `sort_order`, `active`, `metadata_json`, `version` | Shared enumerations used by APIs and admin UI |

Use a composite primary/unique key on `(group_code, code)`. Codes are stable ASCII identifiers and are not silently renamed after use. Display text and ordering may change. `metadata_json` is limited to presentation hints; business columns and relations belong in domain tables.

### Versioned game configuration

| Table | Key columns | Purpose |
| --- | --- | --- |
| `configuration_sets` | `id`, `set_code`, `version`, `status`, `effective_from`, `effective_to`, author/audit columns | Draft, approved and active configuration releases |
| `configuration_values` | `configuration_set_id`, `key`, `value_type`, typed value columns | Operator-adjustable scalar values with validation |
| `configuration_change_log` | set/key, before/after summary, operator, reason, timestamps | Immutable configuration audit |

Probability and reward tables with meaningful rows should use dedicated tables such as `grade_probabilities` or `mode_rewards` linked to a configuration set. They should not be stored as an unvalidated JSON blob.

### Initial hardcoded candidates observed in `main.js`

- Pet-skill slot/bag limits, prices, compatibility groups, skill definitions and grade weights.
- Mini-pet allowed grades, upgrade cost/probability/reward tables and maximum levels.
- Attendance, battle, tower, market, guild-territory, pass, home, package and event limits/rewards/rates under `GLOBAL_CONFIG`.
- Item names currently used as bag keys and command constants.
- Command monitoring limits and exclusions.

Before moving a value, classify it and document its validation range, unit, default, effective time, and whether a running command must snapshot the configuration version. A database value without validation is not safer than a hardcoded value.

The admin website may edit only approved configuration/catalog fields through server APIs. Activation should be an explicit audited operation; partially edited draft values must not affect live commands.

## 3. Currency

| Table | Key columns | Purpose |
| --- | --- | --- |
| `currency_definitions` | `code`, `name`, `precision`, `min_balance`, `active` | Point, diamond, carrot, and future currencies |
| `currency_accounts` | `player_id`, `currency_code`, `balance`, `version` | Current balance |
| `currency_ledger` | `id`, `operation_id`, `sequence_no`, `player_id`, `currency_code`, `delta`, `balance_after`, `reason_code`, timestamps | Immutable balance history |

Rules:

- Unique `(operation_id, sequence_no)` prevents duplicate ledger application.
- Balance and ledger entries are written in the same transaction.
- `currencyLog.json` is an aggregate legacy source, not a trustworthy historical ledger. Import it as reconciliation evidence; start authoritative ledger history at cutover.
- Use integer or fixed decimal types with explicit bounds, never floating point.

## 4. Item Catalog and Inventory

| Table | Key columns | Purpose |
| --- | --- | --- |
| `item_categories` | `code`, parent/category metadata | Extensible item grouping |
| `item_definitions` | `id`, immutable `code`, `display_name`, `category_code`, stackability, tradeability, active/version | Replaces display-name keys in bags and shop objects |
| `item_definition_attributes` | `item_id`, `attribute_code`, typed value columns | Restricted catalog attributes that vary by item class |
| `inventory_stacks` | `player_id`, `item_id`, `quantity`, `version` | Stackable items from `member[*].bag` |
| `inventory_instances` | `id`, `player_id`, `item_id`, `status`, enhancement/ownership fields, `version` | Unique or stateful equipment/items |
| `inventory_ledger` | `id`, `operation_id`, `player_id`, item/instance reference, `quantity_delta`, `reason_code`, timestamps | Immutable grant/deduct/transfer history |

Rules:

- Display names and emoji are presentation data, not primary keys.
- Deduction uses an atomic condition such as `quantity >= requested_quantity` and checks the affected-row count.
- Grant/deduct state and inventory ledger are committed together.
- `itemInfo.json` and `itemList.json` become versioned catalog/import inputs, not player-state tables.

## 5. Pets, Skills, Mini Pets, and Titles

| Table | Purpose |
| --- | --- |
| `pet_definitions` | Pet catalog/type definitions |
| `player_pets` | Main pet ownership and mutable progression from `member_pet.json` |
| `pet_equipment` | Elemental/ring and future equipment slots |
| `skill_definitions` | Stable skill catalog |
| `pet_skills` | Owned/equipped skill relation and slot state |
| `mini_pet_definitions` | Mini-pet catalog from `miniPetData.json` |
| `owned_mini_pets` | Individual mini-pet ownership and progression |
| `mini_pet_collections` | Collection completion by player and definition |
| `title_definitions` | Title catalog with an explicit scope (`player`, `pet`, `mini_pet`) |
| `player_titles`, `pet_titles`, `mini_pet_titles` | Scope-safe ownership/equipped relations |

Pet, skill, title, and member updates that currently save several JSON files become one transaction. Variable equipment metadata may use a transitional JSON column only until its stable fields are confirmed.

## 6. Guilds

| Table | Purpose |
| --- | --- |
| `guilds` | Name, mark, server, level, experience, capacity, notice, join settings, version |
| `guild_members` | One current guild membership per player, role, contribution, timestamps |
| `guild_role_assignments` | Additional roles such as admin or sword master |
| `guild_resource_accounts` | Typed guild funds/resources |
| `guild_resource_ledger` | Immutable guild-resource changes |
| `guild_inventory_stacks` | Stackable warehouse inventory |
| `guild_inventory_instances` | Stateful warehouse assets |
| `guild_posts` | Guild notice/board posts |

The duplicated relationship in `member.json.member[*].guild` and `guildData.json.guilds[*].members` becomes the single authoritative `guild_members` relation.

## 7. Pet Home and Social

| Table | Purpose |
| --- | --- |
| `player_homes` | House name, level/floor, experience, visit/like summaries, version |
| `furniture_definitions` | Catalog from `petSweetHomeInfo.json` |
| `owned_furniture` | Player-owned furniture quantities or instances |
| `furniture_placements` | Placement coordinates, floor/room, rotation and slot state |
| `home_comments` | Guest comments with author and timestamps |
| `home_visits` | Visit history and deduplication period |
| `home_reactions` | Likes/reactions with uniqueness rules |
| `home_activity` | User-visible activity notifications |

Runtime-only files such as `petHomeActivityData.json` and `petHomePlacedFurniture.json` are referenced by the current code but are not present in the repository snapshot. Their physical schema must remain pending until a sanitized structure-only sample is available.

## 8. Events, Towers, Battles, Boards, and Rankings

| Table | Purpose |
| --- | --- |
| `game_seasons` | Time-bounded season/event definition |
| `game_modes` | Trial tower, castle battle, punch, exploration, and future modes |
| `player_mode_progress` | Current floor, tickets, state and version by mode/season |
| `game_results` | Immutable win/loss/score/reward result rows |
| `leaderboard_entries` | Materialized/current ranking by board, season and player |
| `boss_definitions` | Tower/event boss catalogs and reward configuration |
| `board_posts` | General, carrot, guild, or event board posts with a board code |

Separate definitions, current progress, immutable results, and derived leaderboards. Do not store all ranks as nested maps inside a single row.

## 9. Market

| Table | Purpose |
| --- | --- |
| `market_listings` | Seller, asset type, price currency/amount, state, expiry, version |
| `market_listing_assets` | Reserved stack, instance, pet, furniture, or skill reference |
| `market_settlements` | Buyer/seller amounts, fee, completion state and operation ID |
| `market_events` | Append-only listing lifecycle history |

Listing creation reserves the asset. Purchase locks the active listing, transfers the asset and currency, writes settlement/ledgers, and closes the listing in one transaction. Market migration is intentionally last because the current flow spans member, pet, skill, home, market, and currency data.

## 10. Administration and External Integrations

| Table | Purpose |
| --- | --- |
| `operator_accounts` | Admin website authentication identity and status |
| `roles`, `permissions`, `operator_roles`, `role_permissions` | Role-based access control |
| `admin_audit_log` | Immutable before/after summary, actor, target, reason and operation ID |
| `integration_connections` | Provider configuration references; secrets remain outside tracked files |
| `api_clients` | Revocable client identities and scopes for trusted integrations |
| `outbox_events` | Transactional events waiting for Discord/webhook/API delivery |
| `delivery_attempts` | Retry and delivery result metadata |

The server commits domain state and `outbox_events` together, then an integration worker sends Discord or external API messages. This prevents a committed item grant from being lost merely because Discord was temporarily unavailable.

## Legacy Source Mapping

| Legacy source | Primary target |
| --- | --- |
| `member.json` | players, profiles, counters, flags, currencies, inventory, battle progress; embedded global config is separated |
| `attendanceLight.json` | player counters/attendance state after semantics are confirmed |
| `currencyLog.json` | import reconciliation evidence; future writes use currency ledger |
| `member_pet.json` | player pets, equipment, owned mini pets and battle progress |
| `petSkillData.json` | pet skills and equipped slots |
| `member_title.json`, `pet_title.json`, `miniPet_title.json` | scoped title ownership |
| `miniPet_collection.json` | mini-pet collection completion |
| `guildData.json` | guilds, members, roles, resources, warehouse and posts |
| `petSweetHomeData.json`, `petHomeComments.json` | homes, furniture ownership/placement, comments and social state |
| `freeMarket.json` | listings, listing assets, settlements and market events |
| `trialTower.json`, `petExploreData.json`, `castleBattle*.json`, `punchRankData.json` | mode progress, results and leaderboards |
| `board.json`, `carrotBoard.json` | typed board posts |
| `packageLog.json` | immutable grant/admin audit history |
| `packageInfo.json`, `itemInfo.json`, `itemList.json`, `miniPetData.json`, `miniPetCollectionInfo.json`, `petSweetHomeInfo.json`, tower boss JSON | versioned catalogs and definitions |
| `hoiBotChangeLog.json` | release notes if website management is required; otherwise repository-owned reference |
| `requestMonitorConfig.json` | versioned operational settings with restricted admin access |
| `errorLog.json` | do not import as game state; replace with structured application logging |
| `memberBagCheck/memberBagCheck.json` | migration/reconciliation evidence only, not an authoritative table |

## Transaction Boundaries Derived from Current Save Flow

At minimum, the following operations require one database transaction:

- Currency deduction plus inventory grant.
- Inventory deduction plus currency/item ledger entry.
- Pet or mini-pet mutation plus skill/title/inventory updates.
- Guild membership or reward update plus player/guild currency changes.
- Home purchase/placement plus player currency and furniture ownership changes.
- Market reserve/cancel/purchase plus all ownership, currency, fee, settlement, and audit changes.
- Player deletion or restoration across every owned aggregate.

The Kakao/Discord reply is sent after commit. A failure before commit rolls back all related rows.

## Common Physical Rules

- Engine: InnoDB.
- Character set: `utf8mb4`.
- Timestamps: UTC `DATETIME(3)`.
- Primary keys: `BIGINT UNSIGNED`, generated internally.
- External IDs and legacy keys: `VARCHAR` with explicit unique constraints.
- Quantities/counters: `BIGINT` or bounded `INT`; currencies use integer or fixed `DECIMAL` based on confirmed limits.
- Mutable aggregate roots include `version BIGINT UNSIGNED` for optimistic concurrency when appropriate.
- Every foreign key has an intentional delete rule; game ownership data should normally restrict or soft-delete rather than cascade silently.
- Use stable ASCII codes for currencies, items, counters, modes and permissions. Korean names and emoji remain display fields.

## Migration Delivery Order

1. Complete event inbox persistence and operation idempotency.
2. Add generalized players/external identities/channels and resolve Kakao identity mapping.
3. Add import-run/checksum/reconciliation tables.
4. Import versioned catalogs needed by the selected first command.
5. Import a minimal member read projection and compare output against legacy JSON.
6. Add one low-risk single-aggregate mutation with ledger/audit and rollback tests.
7. Move currency, then inventory.
8. Move pets/skills/titles, guilds, homes, modes/rankings, and market in that order.
9. Add admin write APIs only after the same service method is transaction-tested.
10. Add Discord/external adapters against the same application services and outbox.

Avoid permanent dual writes. Each domain gets a checksumed source snapshot, rehearsal import, read comparison, short cutover, and explicit rollback point.

## Required Follow-up Evidence

- Sanitized structure-only samples for runtime files missing from the repository.
- Confirmed maximum values for balances, experience, counters and quantities before choosing final numeric sizes.
- Field-level conversion rules are now recorded in `LEGACY_JSON_FIELD_MAPPING.md`; unresolved runtime-only fields still require sanitized samples.
- Stable catalog codes for items currently keyed by display name.
- The selected first read command is `/내정보`; the first low-risk mutation is `/서버이동`.
- Legacy nickname keys create players and unresolved mapping records. Display-name candidates never auto-link; an administrator must approve the external identity.

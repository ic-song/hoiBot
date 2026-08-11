# hoiBot MariaDB 설계 ERD

- 설계 버전: `028_complete_legacy_domains`
- 검증 DB: `hoibot_schema_design`
- 문자셋: `utf8mb4 / utf8mb4_unicode_ci`
- 원칙: 운영 JSON 값을 그대로 보관하는 dump table 없이 도메인 row로 정규화한다.
- 데이터 단계: 이 문서는 schema만 정의한다. 운영 데이터 전체 이관은 기능 parity와 통합 검증 뒤 마지막 단계에서만 수행한다.

## 핵심 식별자·실행·원장

```mermaid
erDiagram
  PLAYERS ||--|| PLAYER_PROFILES : has
  PLAYERS ||--o{ EXTERNAL_IDENTITIES : identified_by
  CHANNELS ||--o{ CHANNEL_MEMBERSHIPS : contains
  PLAYERS ||--o{ CHANNEL_MEMBERSHIPS : joins
  OPERATIONS ||--o{ COMMAND_AUDIT : audits
  OPERATIONS ||--o{ CURRENCY_LEDGER : records
  OPERATIONS ||--o{ INVENTORY_LEDGER : records
  OPERATIONS ||--o{ OUTBOX_MESSAGES : emits
  PLAYERS ||--o{ CURRENCY_ACCOUNTS : owns
  PLAYERS ||--o{ INVENTORY_STACKS : owns
  ITEM_DEFINITIONS ||--o{ INVENTORY_STACKS : classifies
```

## 사용자·펫·홈

```mermaid
erDiagram
  PLAYERS ||--o{ PLAYER_TITLES : earns
  TITLE_DEFINITIONS ||--o{ PLAYER_TITLES : defines
  PLAYERS ||--|| PLAYER_PETS : owns
  PLAYER_PETS ||--o{ PET_SKILLS : learns
  PLAYER_PETS ||--o{ PET_EQUIPMENT : equips
  PLAYERS ||--o{ OWNED_MINI_PETS : owns
  MINI_PET_DEFINITIONS ||--o{ OWNED_MINI_PETS : defines
  PLAYERS ||--o{ MINI_PET_COLLECTION_ENTRIES : discovers
  OWNED_MINI_PETS ||--o{ MINI_PET_TITLE_ASSIGNMENTS : earns
  PLAYERS ||--|| PLAYER_HOMES : owns
  PLAYER_HOMES ||--o{ OWNED_FURNITURE : contains
  OWNED_FURNITURE ||--o{ FURNITURE_PLACEMENTS : placed_as
  PLAYER_HOMES ||--o{ HOME_COMMENTS : receives
  PLAYER_HOMES ||--o{ HOME_ACTIVITY_EVENTS : records
```

## 길드·커뮤니티·공성전

```mermaid
erDiagram
  GUILDS ||--o{ GUILD_MEMBERS : contains
  PLAYERS ||--o| GUILD_MEMBERS : joins
  GUILDS ||--o{ GUILD_RESOURCE_ACCOUNTS : owns
  GUILDS ||--o{ GUILD_WAREHOUSE_STACKS : stores
  GUILDS ||--o{ GUILD_BOARD_POSTS : publishes
  CHANNELS ||--o{ COMMUNITY_BOARDS : scopes
  COMMUNITY_BOARDS ||--o{ COMMUNITY_POSTS : contains
  PLAYERS ||--o{ COMMUNITY_POSTS : writes
  CASTLE_BATTLE_SEASONS ||--o{ CASTLE_BATTLE_PARTICIPANTS : ranks
  GUILDS ||--o{ CASTLE_BATTLE_PARTICIPANTS : competes
```

## 이벤트·상품·시장

```mermaid
erDiagram
  ATTENDANCE_PROGRAMS ||--o{ PLAYER_ATTENDANCE : tracks
  PLAYERS ||--o{ PLAYER_ATTENDANCE : checks_in
  EVENT_SEASONS ||--o{ PLAYER_EVENT_PROGRESS : tracks
  GAME_MODE_DEFINITIONS ||--o{ PLAYER_EVENT_PROGRESS : classifies
  TOWER_DEFINITIONS ||--o{ PLAYER_TOWER_PROGRESS : tracks
  PLAYERS ||--o{ PLAYER_TOWER_PROGRESS : climbs
  PET_EXPEDITION_DEFINITIONS ||--o{ PET_EXPEDITION_RUNS : defines
  PLAYER_PETS ||--o{ PET_EXPEDITION_RUNS : performs
  PACKAGE_DEFINITIONS ||--o{ PACKAGE_CONTENTS : contains
  PACKAGE_DEFINITIONS ||--o{ PACKAGE_PURCHASES : purchased_as
  PLAYERS ||--o{ PACKAGE_PURCHASES : purchases
  PLAYERS ||--o{ MARKET_LISTINGS : sells
  MARKET_LISTINGS ||--o| MARKET_SETTLEMENTS : settles
```

## 운영·이관

```mermaid
erDiagram
  LEGACY_IMPORT_RUNS ||--o{ LEGACY_IMPORT_FILES : inventories
  LEGACY_IMPORT_RUNS ||--o{ LEGACY_IMPORT_ANOMALIES : reports
  PLAYERS ||--o{ BAG_INTEGRITY_CHECKS : checked_by
  CHANNELS ||--o{ REQUEST_MONITOR_POLICIES : governed_by
  NORMALIZED_PROVIDER_EVENTS ||--o{ MODERATION_INCIDENTS : detects
  MODERATION_INCIDENTS ||--o| RETAINED_EVENT_CONTENTS : retains
```

## authoritative 저장소 매핑

| 기존 저장소 | 목적 테이블 |
|---|---|
| `attendanceLight.json` | `attendance_programs`, `player_attendance` |
| `board.json`, `carrotBoard.json` | `community_boards`, `community_posts` |
| `castleBattle2.json` | `castle_battle_seasons`, `castle_battle_participants` |
| `currencyLog.json` | `currency_ledger` |
| `freeMarket.json` | `market_listings`, `market_settlements`, `market_events`, `market_fee_ledger` |
| `guildData.json` | `guilds`, `guild_members`, `guild_roles`, `guild_resource_accounts`, `guild_warehouse_stacks` |
| `itemList.json` | `item_definitions`, `inventory_stacks`, `inventory_instances` |
| `member.json` | `players`, `player_profiles`, `currency_accounts`, `player_counters`, `player_passes`, `player_badge_assignments` |
| `member_pet.json`, `petSkillData.json` | `player_pets`, `pet_skills`, `pet_equipment` |
| `member_title.json`, `pet_title.json`, `miniPet_title.json` | `title_definitions`과 각 title assignment table |
| `miniPet_collection.json` | `mini_pet_collection_entries` |
| `memberBagCheck/memberBagCheck.json` | `bag_integrity_checks` |
| `packageInfo.json`, `packageLog.json` | `package_definitions`, `package_contents`, `package_purchases` |
| `petExploreData.json` | `pet_expedition_definitions`, `pet_expedition_runs` |
| `petSweetHomeData.json` | `player_homes`, `owned_furniture`, `furniture_placements` |
| `petHomeComments.json` | `home_comments` |
| `petHomeActivityData.json` | `home_visits`, `home_reactions`, `home_activity_events` |
| `petHomePlacedFurniture.json` | `furniture_placements` |
| `punchRankData.json` | `leaderboards`, `leaderboard_entries` |
| `trialTower.json` | `tower_definitions`, `player_tower_progress` |
| `requestMonitorConfig.json` | `request_monitor_policies` |

## 설계 경계

- 금액·수량 변경은 `operations`와 해당 ledger를 같은 transaction에서 기록한다.
- 사용자·길드·아이템 삭제는 운영 기록 보존을 위해 기본 `RESTRICT`다.
- 원문이 필요한 게시글·댓글만 `TEXT`를 사용하고, 규칙·정의 확장값에만 `JSON`을 허용한다.
- `legacy_import_*`는 실행 증거와 anomaly용이며 운영 JSON payload 보관소가 아니다.
- 누락 운영 파일 2개는 합성 fixture로 schema와 로직만 검증하며 최종 이관 증거로 인정하지 않는다.

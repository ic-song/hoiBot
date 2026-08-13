# 운영 PC DB·테이블 초기화 자료

이 문서는 개발 PC에서 검증한 hoiBot MariaDB schema를 운영 PC에 재설치할 때 필요한 자료와 순서를 고정한다. 비밀번호, 운영 사용자 데이터, KakaoTalk 원문은 이 문서와 Git에 저장하지 않는다.

## 1. 설치 기준

| 항목 | 기준 |
|---|---|
| MariaDB | `11.8.8` |
| Docker image | `mariadb:11.8.8@sha256:efb4959ef2c835cd735dbc388eb9ad6aab0c78dd64febcd51bc17481111890c4` |
| 운영 DB 기본 이름 | `hoibot` |
| 개발 schema 검증 DB | `hoibot_schema_design` |
| engine | `InnoDB` |
| character set | `utf8mb4` |
| collation | `utf8mb4_unicode_ci` |
| timezone | DB container `UTC`, 운영 표시 `Asia/Seoul` |
| migration | `001_foundation.sql` ~ `030_pet_creation_foundations.sql` |
| 정상 물리 결과 | migration 30개, base table 121개, column 845개, FK 174개 |

컬럼과 관계 전체는 [HOIBOT_DATABASE_ERD.md](./HOIBOT_DATABASE_ERD.md)의 `전체 물리 컬럼 ERD`를 기준으로 한다.

## 2. 운영 PC에 전달할 파일

- `개발환경_고도화/infra/compose.yaml`
- `개발환경_고도화/runtime/migrations/*.sql`
- `개발환경_고도화/runtime/scripts/migrate.ts`
- `개발환경_고도화/runtime/src/config.ts`
- `개발환경_고도화/runtime/package.json`과 lock file
- 배포할 hoiBot Server image 또는 동일 Git commit의 runtime build 결과
- 이 문서와 `HOIBOT_DATABASE_ERD.md`
- 최종 이관 시 별도로 승인·고정한 운영 snapshot과 checksum manifest

개발 PC의 Docker volume과 `hoibot_schema_design` DB 자체는 운영 PC로 복사하지 않는다. 운영 PC에서는 migration으로 빈 schema를 재현한다.

## 3. Git에 기록하지 않을 환경값

운영 PC의 비밀 저장소 또는 운영 전용 `.env`에 다음 이름으로 준비한다.

```dotenv
MARIADB_ROOT_PASSWORD=<secret>
MARIADB_DATABASE=hoibot
MARIADB_USER=hoibot_app
MARIADB_PASSWORD=<secret>
MARIADB_HOST_PORT=<localhost-only-port>
DATABASE_ENABLED=true
DATABASE_HOST=mariadb
DATABASE_PORT=3306
DATABASE_USER=hoibot_app
DATABASE_PASSWORD=<same-application-secret>
DATABASE_NAME=hoibot
```

- 실제 값이 들어간 `.env`는 Git, 문서, 메신저에 첨부하지 않는다.
- MariaDB host port는 외부 공개하지 않고 `127.0.0.1`에만 bind한다.
- server container에서는 host port가 아니라 Docker network의 `mariadb:3306`을 사용한다.

## 4. 운영 PC 초기화 순서

1. 배포 대상 Git commit과 아래 migration checksum을 확인한다.
2. 운영 데이터가 없는 신규 MariaDB volume을 준비한다.
3. MariaDB container만 먼저 시작하고 health 상태를 확인한다.
4. 운영 DB와 application user 권한을 생성한다.
5. runtime에서 `npm.cmd run db:migrate` 또는 Linux의 `npm run db:migrate`를 실행한다.
6. migration·table·column·FK 수를 확인한다.
7. 서버를 시작해 DB readiness와 transaction rollback probe를 실행한다.
8. 기능별 임시데이터 검증이 필요하면 운영 DB가 아닌 별도 rehearsal DB에서 실행한다.
9. 운영 오픈 직전 rehearsal DB를 폐기하고 깨끗한 운영 DB에 migration만 다시 적용한다.
10. 승인된 최신 전체 운영 snapshot을 마지막 단계에서 import하고 reconciliation한다.

운영 데이터 import 전까지 운영 DB에는 schema와 고정 reference seed만 존재해야 한다.

## 5. Docker 초기 기동

PowerShell:

```powershell
docker compose -f 개발환경_고도화/infra/compose.yaml up -d mariadb
docker compose -f 개발환경_고도화/infra/compose.yaml ps mariadb
```

Linux:

```bash
docker compose -f 개발환경_고도화/infra/compose.yaml up -d mariadb
docker compose -f 개발환경_고도화/infra/compose.yaml ps mariadb
```

health 상태가 `healthy`가 되기 전에는 migration과 데이터 import를 실행하지 않는다.

## 6. Schema migration

개발 PC 직접 검증과 달리 운영 PC에서는 `DATABASE_NAME=hoibot`을 사용한다.

```bash
cd 개발환경_고도화/runtime
npm ci
npm run db:migrate
```

- migration은 파일명 순서로 적용된다.
- 적용된 파일과 SHA-256은 `schema_migrations`에 기록된다.
- 이미 적용된 migration 파일을 수정하지 않는다. 변경은 다음 번호 migration으로 추가한다.
- checksum mismatch가 발생하면 강제 덮어쓰기하지 않고 배포 commit과 DB 적용 이력을 먼저 대조한다.

## 7. 설치 결과 검증 SQL

```sql
SELECT COUNT(*) AS migration_count FROM schema_migrations;

SELECT COUNT(*) AS base_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_type = 'BASE TABLE';

SELECT COUNT(*) AS column_count
FROM information_schema.columns
WHERE table_schema = DATABASE();

SELECT COUNT(*) AS foreign_key_count
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE();
```

예상값:

```text
migration_count = 29
base_table_count = 119
column_count = 831
foreign_key_count = 171
```

아래 대표 테이블도 모두 존재해야 한다.

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'players',
    'currency_accounts',
    'inventory_stacks',
    'player_pets',
    'player_pet_elementals',
    'pet_skill_inventory',
    'guilds',
    'player_homes',
    'market_listings',
    'pre_signup_attendance',
    'player_attendance',
    'community_posts',
    'castle_battle_seasons',
    'package_purchases',
    'pet_expedition_runs',
    'player_tower_progress',
    'request_monitor_policies'
  )
ORDER BY table_name;
```

## 8. Migration SHA-256 manifest

| migration | SHA-256 |
|---|---|
| `001_foundation.sql` | `96c49a66c75f6e5015f7145ac4767187d17ba0809ca6b4aa2c4172a8a56ef5e7` |
| `002_event_processing.sql` | `343b0b7e94cb98c406733e60ddb12252974eb55a823f59d6f4d71bc82d3faa35` |
| `003_identity_import.sql` | `2da90d27d1c58c8d9e8903b8342461522f7617b088882b8b0a264cb4d70743b9` |
| `004_common_codes_config.sql` | `bdbfaebe2a645699276991911a888b1f0c84da057cccd43b083464d43dfb83cd` |
| `005_player_profile.sql` | `6024df5e493fdabda2238741050e8ae256dc4d17c9c5e773c24a5082f3ddab22` |
| `006_admin_auth.sql` | `79f8ab301974e66a8cb692eb5c6d969cfc6b254d3580e2ada7531b877f53351a` |
| `007_domain_foundations.sql` | `b259a2d91fc2a95047a6e45772ac75e92893761f06e105823aebf2c041031b18` |
| `008_admin_iris_identity.sql` | `7e2d4a5e61368c1ae00db670c6413ed2f3e0e330c8f46250d0979c6b7c9ac062` |
| `009_event_identity_links.sql` | `c3e7c84511e41011d7b29166a394e692eb9a2581ebcbf2f7cc5d75c58142d0d2` |
| `010_legacy_display_capacity.sql` | `c1c7d29481634ee9a386074cb0856d350c6098fc47def38756d0d69116bc8dff` |
| `011_mini_pet_display_projection.sql` | `69989039483a4eeab68beaef9ac9fd19ee78ad3dd5217614934095b405745810` |
| `012_badge_display_projection.sql` | `6f1efa1c3bbcf73e63ea5b001e6022f838d9bf024518168271a2cfa90c574cfe` |
| `013_domain_service_ledgers.sql` | `6e0ea0cbd692d223f72c48ad8f3adbc1ce16139a2da80713a71f9cb55e2fce7a` |
| `014_market_fee_ledger.sql` | `56b7a1748cb7c61043cdd371606f60ae0d52307992e5462124c96eea51eed719` |
| `015_player_signup.sql` | `7b323094de6f76e70626e6574212e2f063e1749a5fcbd45f4eaa0369b23f3f7f` |
| `016_site_signup_auth.sql` | `7ae6b403fa3810dd4aed9b51fb35b1d822f6c6daa0f3c9b7a17d3ea9a82199be` |
| `017_admin_authorization_lifecycle.sql` | `0416a4a423f3453ed29c3c67d3d825cbc018c48931c1dd7bbbfefaffeec8e813` |
| `018_remove_legacy_admin_authorization.sql` | `63140d842e6557c7113d3d84db6026254f62bf1d06fc63c61cd44955889cdff2` |
| `019_user_auth_hardening.sql` | `e83f99837cf9a25fa4e4ed7113781d26471bef7d71d2651628f4cb4f1146c2e3` |
| `020_trusted_identity_activity_events.sql` | `5bd5b0148033e00821339a20248fa2b324cd6d1c5503dec251965ffa01842583` |
| `021_moderation_hidden_by_host.sql` | `b53823d9eb2ce6125c4de31f03708fe2c086ead5b4a40de1baac104288628a80` |
| `022_monitoring_console.sql` | `4511bbf1ed10994a860947f9771af47bf78053339229fd023c97bb52206cd862` |
| `023_incident_content_read.sql` | `d8613a789f152dcd295d3033364bebd39ba5fdee327113f64a7a405e0f89f711` |
| `024_event_content_retention.sql` | `fce6d019870b8d5d4ef90154a76d85dc22bfcee240fcecc3c7d71fdef0114486` |
| `025_monitoring_event_groups.sql` | `992f2ffc4878d45d9cd92a2943a0a7027ec3980f5513c53510560d29cbca43e3` |
| `026_media_image_video_only.sql` | `5d57a7b82058764b61a71c7a01645c6b87866554428f7df9f8b43a7c14137764` |
| `027_remove_reply_monitoring_group.sql` | `057e71e3ee1eb7f9d78066debb1563eb8386109c6fe5cc2801e2cdedb2638afb` |
| `028_complete_legacy_domains.sql` | `9cabbe263f59d546d7f8ef5939b13784fba055811b0728ccb80472d15d37124e` |
| `029_pre_signup_attendance.sql` | `2e86ebccd682730efe86c142680dbb395f175433e505c142ce0ccb3528acc46d` |
| `030_pet_creation_foundations.sql` | `6c7b1474045ba9c1db67aa2d10e700f24fcc226f8fa954bd219b859041867266` |

## 9. 실제 운영 데이터 최종 이관 전 필수 자료

- 최신 운영 snapshot의 전체 파일 목록
- 파일별 byte size와 SHA-256
- 현재 authoritative 파일 26개와 운영 PC에서 추가 확인될 파일
- 누락 확인 중인 `petHomeActivityData.json`, `petHomePlacedFurniture.json` 실제 파일
- source root hash
- 최종 importer 버전과 Git commit
- 파일별 source record count와 목적 테이블 row count
- 사용자 수, 재화 총합, 아이템 소유권, 길드 관계, FK/orphan/anomaly reconciliation 결과
- freeze 시작·종료 시각과 rollback 기준

합성 fixture와 합성 import run은 위 운영 이관 증거에 포함하지 않는다.

## 10. 재설치 중단 조건

- migration checksum 불일치
- 예상 migration/table/column/FK 수 불일치
- 운영 DB에 합성 사용자 또는 rehearsal 데이터 존재
- 실제 운영 snapshot 파일 누락 또는 checksum 변경
- reconciliation에서 재화·수량·소유권 불일치
- 운영 비밀이 Git 또는 로그에 노출됨

하나라도 발생하면 데이터 import와 운영 전환을 중단하고 체크포인트에 마지막 성공 단계와 증거를 기록한다.

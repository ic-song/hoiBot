# SL-ASSET-MINIPET-COLLECTION-STAGE-TITLE-BINDING-CORRECTION-01 검증

- Lease: `2487`
- WBS: `713`
- 실행 ID: `자산카탈로그-SL-ASSET-MINIPET-COLLECTION-STAGE-TITLE-BINDING-CORRECTION-01-202609012315`
- 기준 커밋: `ee934c78e6503504ac35ce2aca6417605595e11e`
- 마이그레이션: `437_asset_minipet_collection_stage_title_binding_correction.sql`
- 카탈로그 버전: `ASSET-FREEZE-v2.438-mini-pet-collection-reward-title-binding-01`
- 원본 SHA-256: `3dadafd107bb82480d6d5218f98af2a31d0037af7c15b5fecaf8d3c62b9a4e39`

## 정합성

- 기존 `title_definitions`의 `mini_pet_collection` 안정 코드 100개를 그대로 재사용했습니다.
- `sourceRow 1..100` 각각에 독립된 `TITLE` object와 exact `LEGACY_JSON` source binding을 연결했습니다.
- 식별 계약은 `source_file + source_section + source_row + definition_code`이며 표시명만으로 병합하지 않습니다.
- 기존 `ASSET-FREEZE-v2.435-mini-pet-collection-reward-01` 108행과 `UNRESOLVED 100`은 수정하지 않았습니다.
- 새 SHADOW 카탈로그는 108행, `RESOLVED 100`, `NOT_APPLICABLE 8`, conflict 0, gap 0입니다.
- 기존 미니펫 컬렉션 reward provider와 object catalog exact lookup 계약을 재사용하며 새 schema/provider/consumer는 추가하지 않았습니다.

## 검증 결과

- focused test: `5/5 PASS`
- TypeScript typecheck: `PASS`
- build: `PASS`
- fresh isolated MariaDB migration: `426`개 적용, migration 437 포함
- replay: 추가 적용 `0`
- relational/provider probe: `4/4 PASS`
- narrow rollback: 기존 catalog 1, 신규 catalog 0, 신규 source binding 0
- rollback/replay: migration 437 재적용 및 probe `PASS`
- MariaDB restart/reconnect: 새 임의 포트에서 provider probe `PASS`
- full regression: `1,570 total / 1,562 pass / 0 fail / 8 skip`
- Gate 8: `FALSE`

## 관리 웹 후속 계약

- domain kind: `TITLE`, `MINI_PET_COLLECTION_REWARD`
- definition 조회: `title_definitions.scope_code='mini_pet_collection'` + stable code
- source binding 조회: `LEGACY_JSON | data/miniPetCollectionInfo.json#titles | sourceRow`
- conflict/gap 상태: 새 버전 `0/0`, 기존 버전 unresolved `100` 보존
- publish 상태: `SHADOW`
- 기존 admin API 재사용: object exact lookup과 reward provider는 가능하며, 통합 목록·검색·필터·버전 발행 준비 화면은 후속 공용 Lease 대상입니다.

## 안전 경계

- `main.js`, `Info.js`, `data/*`, 보유/실행/타이머 데이터는 변경하지 않았습니다.
- 신규 schema/provider, ownership, consumer cutover, feature/prod, 운영 DB를 변경하지 않았습니다.
- Gate 8은 진행하지 않았습니다.

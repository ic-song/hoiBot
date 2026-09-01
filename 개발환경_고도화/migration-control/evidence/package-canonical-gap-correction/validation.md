# SL-ASSET-PACKAGE-CANONICAL-GAP-CORRECTION-01 검증

- Lease: `2489`
- WBS: `714`
- 실행 ID: `자산카탈로그-SL-ASSET-PACKAGE-CANONICAL-GAP-CORRECTION-01-202609012345`
- 기준 커밋: `60df8b2771636a0b35d0c2961ae5a0b41bde58f4`
- 마이그레이션: `439_asset_package_canonical_gap_correction.sql`
- 카탈로그 버전: `ASSET-FREEZE-v2.438-package-canonical-gap-correction-01`
- 원본: `5925b83b1dbfb78ef583354604e112b9430003f3:data/packageInfo.json`
- 원본 SHA-256: `4d2072a8e829391cb2ad546ca9ba37d7081c677bdb9e2dedbc7e08e12697e7dc`

## 정합성

- 기존 typed catalog 107 package / 557 reward occurrence와 source order, identity hash를 새 SHADOW 버전에 그대로 복제했습니다.
- 기존 동결 판정 `STACK RESOLVED 467 / GAP 46`, `PACKAGE SOURCE_RESOLVED_CANONICAL_GAP 44`는 수정하지 않았습니다.
- exact `LEGACY_JS | member.bag | target display` source binding과 canonical object key, definition code가 모두 일치하는 STACK 10 occurrence만 sidecar overlay로 연결했습니다.
- 연결 대상은 `ITEM-RWD-016` 5건, `ITEM-RWD-034` 3건, `ITEM-PACKAGE-204` 1건, `ITEM-PACKAGE-206` 1건입니다.
- effective identity 상태는 `RESOLVED 477`, residual STACK gap 36, residual PACKAGE gap 44, conflict 0입니다.
- 4개 기존 definition/object는 현재 inactive입니다. identity 연결과 사용 가능 상태를 분리하며, overlay만으로 활성 또는 지급 가능 상태를 추론하지 않습니다.
- 표시명 유사성만으로 병합하거나 신규 identity를 만들지 않았습니다.

## 검증 결과

- focused test: `5/5 PASS`
- TypeScript typecheck: `PASS`
- build: `PASS`
- fresh isolated MariaDB migration: `427`개 적용, migration 439 포함
- replay: 추가 적용 `0`
- relational/provider probe: `4/4 PASS`
- narrow rollback: 신규 catalog 0, 신규 overlay binding 0
- rollback/replay: migration 439 재적용 및 probe `PASS`
- MariaDB restart/reconnect: Docker 임의 포트 재조회 후 provider probe `PASS`
- full regression: `1,575 total / 1,567 pass / 0 fail / 8 skip`
- Gate 8: `FALSE`

## 관리 웹 후속 read contract

- catalog version: `asset_package_typed_target_catalogs.catalog_version`
- domain kind: `asset_package_reward_target_occurrences.target_type`
- definition: `object_registry.metadata_json.definitionCode -> item_definitions.code`
- source binding: `RUNTIME_DB | asset_package_reward_target_occurrences | <catalog_version>#<global_source_order>`
- frozen status: occurrence의 기존 `resolution_status`
- effective status: versioned overlay가 있을 때만 `RESOLVED_BY_EXACT_SOURCE_BINDING`, 없으면 `UNRESOLVED_CANONICAL_GAP`
- conflict/gap: conflict와 residual STACK 36 / PACKAGE 44를 별도 표시
- publish state: catalog의 `publication_status=SHADOW`
- package reward target link: `catalog_version + global_source_order`
- availability: `item_definitions.active`를 별도 표시하고 inactive identity를 사용 가능으로 표시하지 않음
- 기존 provider 재사용: frozen view는 `MariaPackageTypedRewardTargetCatalogProvider`를 변경 없이 사용
- 통합 목록·검색·필터와 publish 준비 화면은 후속 공용 admin web Lease 대상

## 안전 경계

- `main.js`, `Info.js`, `data/*`, 보유/실행/타이머 데이터는 변경하지 않았습니다.
- schema, provider, consumer, canonical identity, ownership, ledger, feature/prod, 운영 DB를 변경하지 않았습니다.
- Gate 8은 진행하지 않았습니다.

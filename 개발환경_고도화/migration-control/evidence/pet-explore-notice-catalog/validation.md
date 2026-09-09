# SL-ASSET-PET-EXPLORE-NOTICE-CATALOG-01 검증

- 기준 커밋: `dd2b63f315d72a445ab4cd55f13c90dc5ae0ccd8`
- 구현 커밋: `73ff47a06c872cb1490368d731aa28513466f873`
- 승인 원본: `5925b83b1dbfb78ef583354604e112b9430003f3:data/petExploreData.json#notice`
- 카탈로그 버전: `ASSET-FREEZE-v2.438-pet-explore-notice-01`
- 마이그레이션: `430_pet_explore_notice_catalog.sql`

## 정합성

- 승인된 펫탐험 공지 1개를 3줄, UTF-16 66자, UTF-8 108바이트 그대로 고정했습니다.
- 기존 `operation_notices` 활성 configuration set에 `notice.pet_explore` key를 추가하고 최초 exact 값을 immutable catalog binding으로 연결했습니다.
- 기존 운영공지 provider의 전체 key 복제 방식에서 펫탐험 공지가 다음 버전에도 유지됨을 Shadow로 확인했습니다.
- 이미 관리된 동일 key는 재실행 시 덮어쓰지 않습니다.
- provider, consumer, 명령어, 보유 데이터, 운영 데이터 변경은 없습니다.

## 검증 결과

- focused test: 7/7 PASS
- TypeScript typecheck: PASS
- build: PASS
- fresh MariaDB migration: 412개 적용, migration 430 포함
- replay: applied 0
- rollback: 신규 catalog/key 0, 기존 공지 3개·head·펫탐험 event config 보존
- rollback/replay/restart/reconnect: PASS
- relational probe: 5/5 PASS
- Shadow provider clone parity: 1/1 PASS, configuration values 4개 보존
- full regression: 1,415 total / 1,408 pass / 0 fail / 7 skip
- Gate 8: FALSE

전용 합성 MariaDB 컨테이너에서만 검증했으며 feature/prod 및 운영 DB는 변경하지 않았습니다.

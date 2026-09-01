# SL-COMMON-ASSET-PRESERVATION-INTEGRATION-01 검증

- 기준 커밋: `5e3fa90b`
- 통합 대상: Gate 1~7 완료 브랜치 tip 76개
- 최상위 축: 기준 포함 9개, 별도 병합 8개
- 통합 후 누락 조상: 0개
- Gate 8: FALSE

## 보존 통합

- 완료된 76개 브랜치의 커밋을 ancestry DAG로 축약하고, 기준 브랜치가 이미 포함한 이력을 제외한 8개 최상위 축만 병합했습니다.
- 관리 웹 충돌은 최신 공용 shell을 유지하면서 백업 복구 route를 등록하는 방식으로 해결했습니다.
- 앱 route 충돌은 관리 웹 shell과 사이트 가입 route를 모두 등록하도록 해결했습니다.
- 길드 통화는 `guild_fund`, 플레이어 포인트는 `point`로 분리되어 있으며 전역 `POINT` alias는 만들지 않았습니다.
- 통합으로 추가된 특권 포인트 순위 조회 provider를 반영해 통화 provider 동결값을 58개로 교정했습니다.

## 마이그레이션

- 전용 합성 MariaDB 11.8.8에서 fresh migration 425개를 적용했습니다.
- 재실행 시 신규 적용은 0개였습니다.
- 기존 051 중복과 통합된 401~411 중복 접두번호는 full filename을 version key로 사용해 모두 독립 적용됐습니다.
- 401~411의 중복 접두 파일 22개가 `schema_migrations`에 모두 기록됐습니다.
- MariaDB 재시작 후 migration 425개, 펫스킬 catalog 93개, 펫스킬 설정값 4개, `point` 1개, `guild_fund` 1개를 재확인했습니다.
- 운영 DB와 legacy JSON은 변경하지 않았습니다.

## 검증 결과

- 통화 provider 집중 검증: 7/7 PASS
- TypeScript typecheck: PASS
- build: PASS
- full regression: 1,554 total / 1,546 pass / 0 fail / 8 skip
- JSON parse 및 `git diff --check`: PASS
- Gate 1~7: TRUE
- Gate 8: FALSE

합성 검증용 컨테이너만 사용했으며 feature/prod 및 운영 DB는 변경하지 않았습니다.

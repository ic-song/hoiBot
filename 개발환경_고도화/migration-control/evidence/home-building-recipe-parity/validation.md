# SL-ASSET-HOME-BUILDING-RECIPE-PARITY-01 검증

- 기준 커밋: `972c371d6e740bf7327e4df52c1049886ca5fc70`
- 구현 커밋: `ff037eb6`
- 승인 원본: `5925b83b1dbfb78ef583354604e112b9430003f3:data/petSweetHomeInfo.json`
- 카탈로그 버전: `ASSET-FREEZE-v2.438-home-building-recipe-01`
- 마이그레이션: `428_home_building_recipe_parity.sql`

## 정합성

- 건물 identity 299개와 순서 300행을 기존 canonical object에 연결했습니다.
- 승인 원본에서 변경된 제작 재료 목록 300행과 재료 occurrence 2,683개를 순서대로 보존했습니다.
- 10개 재료 target 중 기존 8개 정의를 재사용하고 철근·목재 STACK 정의 2개만 추가했습니다.
- 190층의 서로 다른 2행과 263층의 동일 identity 중복 2행을 병합하지 않고 보존했습니다.
- 신규 보유 모델, provider, consumer cutover, 운영 데이터 변경은 없습니다.

## 검증 결과

- focused test: 7/7 PASS
- TypeScript typecheck: PASS
- build: PASS
- fresh MariaDB migration: 410개 적용, migration 428 포함
- replay: applied 0
- rollback: 신규 catalog/row/requirement/item/object 0, 기존 progression 300행 보존
- rollback/replay/restart/reconnect: PASS
- relational probe: 7/7 PASS
- Shadow parity: 2,683/2,683 PASS
- full regression: 1,401 total / 1,394 pass / 0 fail / 7 skip
- Gate 8: FALSE

전용 합성 MariaDB 컨테이너에서만 검증했으며 feature/prod 및 운영 DB는 변경하지 않았습니다.

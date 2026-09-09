# SL-ASSET-HOME-FURNITURE-DRAW-PARITY-01 검증

- 기준 커밋: `142870c965f2cee33e59fd2c52b481c2c67fd03f`
- 구현 커밋: `f9bb3b91`
- 승인 원본: `5925b83b1dbfb78ef583354604e112b9430003f3:data/petSweetHomeInfo.json`
- 카탈로그 버전: `ASSET-FREEZE-v2.438-home-furniture-draw-01`
- 마이그레이션: `426_home_furniture_draw_parity.sql`
- 롤백: `426_home_furniture_draw_parity.sql`

## 정합성

- 승인 원본 2,447행과 7개 등급을 순서대로 보존했습니다.
- 정확한 `name+exp+grade+display` 조합 2,422개를 정의 identity로 사용했습니다.
- 기존 정의 1,444개를 재사용하고 신규 정의 978개만 추가했습니다.
- 중복 9개 그룹, 중복 행 34개, 추가 weight occurrence 25개를 병합하지 않고 보존했습니다.
- 신규 보유 모델, provider, consumer cutover, 운영 데이터 변경은 없습니다.

## 검증 결과

- focused test: 7/7 PASS
- TypeScript typecheck: PASS
- build: PASS
- fresh MariaDB migration: 409개 적용, migration 426 포함
- replay: applied 0
- rollback/replay: PASS
- restart/reconnect: PASS
- relational probe: 6/6 PASS
- Shadow parity: 2,447/2,447 PASS
- full regression: 1,394 total / 1,387 pass / 0 fail / 7 skip
- Gate 8: FALSE

전용 합성 MariaDB 컨테이너에서만 검증했으며 feature/prod 및 운영 DB는 변경하지 않았습니다.

# SL-HOME-BADGE-GACHA-OPEN-01-03

- 기준: v2.400 / `a286279b`
- 카탈로그: `FROZEN-20260820`, definition version `930000002`
- 구현: DB 정책·티켓·등급 가중치·결정적 RNG trace·assignment/tombstone·중복 포인트·ordered outbox
- 명령: `/홈뱃지오픈`, `/홈뱃지오픈 [숫자]`, `/홈뱃지오픈2 [숫자]`, `/홈뱃지오픈3`
- Rollout: SHADOW
- Gate8: 미진행
- 금지 경계: `main.js`, `Info.js`, 운영 DB/JSON 불변
- 단위: 4/4 통과
- 전체 회귀: 1,121 tests / 1,114 pass / 0 fail / 7 skip
- 정적 검증: typecheck/build 통과
- MariaDB: migration 365건 최초·재적용, rollback, 동일 event 동시 replay, same-batch 중복, tombstone 무재지급, deleted S ordered notice 통과
- 재시작: 추가 mutation 없음

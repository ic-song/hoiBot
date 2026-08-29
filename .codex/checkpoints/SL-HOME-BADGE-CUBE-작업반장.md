# SL-HOME-BADGE-CUBE

- 기준: v2.400 / `a286279b`
- 기준 커밋: `4732b998ff995521b4112f39d3f870d1df7e8d14`
- 카탈로그: `FROZEN-20260820`, definition version `930000002`, cube config version `930000003`
- 구현: DB 옵션·재고·51개 확률 구간·결정적 2단계 RNG trace·정수 보호선·milestone/all-max ordered outbox
- 명령: `/홈뱃지큐브 [홈뱃지번호] [옵션번호] [횟수]`
- Rollout: SHADOW
- Gate8: 미진행
- 금지 경계: `main.js`, `Info.js`, 운영 DB/JSON 불변
- 단위: 4/4 통과
- 전체 회귀: 1,125 tests / 1,118 pass / 0 fail / 7 skip
- 정적 검증: typecheck/build 통과
- MariaDB: migration 366건 최초·재적용, rollback, 동일 event 동시 replay, tombstone 제외, milestone/all-max ordered outbox 통과
- 재시작: 추가 mutation 없음

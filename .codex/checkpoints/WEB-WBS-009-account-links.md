# WEB-WBS-009 계정 연결 상세

- Slice: `SL-ACCOUNT-USER-WEB-CONTEXT-CONSUMER-01`
- Lease: `Lease2637`
- Base catalog: `SC-20260902-1`
- Delta: `SCD-WEB-20260910-2`
- Evidence schema: `web-account-link-detail-v1`
- Baseline: `b63debf9a3ba3abf3964356f909f88700fe409f6`

## 구현

- `/account`, `/account/links`를 기존 이용자 셸에 추가했다.
- 현재 세션과 현재 게임 프로필 API만 읽는다.
- 웹 로그인 ID는 마스킹하고 내부 account/player 식별자는 표시하지 않는다.
- 연결 해제와 계정 전환 mutation은 추가하지 않았다.

## 검증

- `node --import tsx --test test/user-shell.test.ts`: 6/6 PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `/account` 375, 768, 1024, 1440: 4/4 PASS, `overflowX=0`
- 운영 DB·운영 데이터·`feature/prod`·Gate 8: 변경 없음

## Gate 상태

- 기존 Gate와 WEB-WBS-008R Gate 7을 유지한다.
- 이 증분 변경의 Gate 7은 독립 검토 전까지 완료로 보지 않는다.

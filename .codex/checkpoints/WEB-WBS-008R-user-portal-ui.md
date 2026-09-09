# WEB-WBS-008R 이용자 포털 UI 재설계

- Slice: `SL-COMMON-USER-WEB-SHELL-UX-REFINEMENT-01`
- Lease: `Lease2636`
- Base catalog: `SC-20260902-1`
- Delta: `SCD-WEB-20260910-1`
- Evidence schema: `web-user-portal-ui-v2`
- Baseline: `5d4aee340f8eae9b830d1e25dc2bc7c5d3bf6d15`

## 변경 범위

- `/login`을 960px 이내의 일반적인 계정 로그인 카드 구조로 정리했다.
- `/app`의 사이드바 메뉴가 남는 세로 공간으로 늘어나지 않도록 고쳤다.
- 계정 요약 3개, 게임 프로필, 이용 안내를 한 화면에서 찾기 쉬운 대시보드로 재배치했다.
- 모바일 메뉴는 2열, 데스크톱은 224px 1열 내비게이션으로 표시한다.
- 기존 세션·프로필 API, CSRF, 마스킹, 오류 처리는 변경하지 않았다.

## 검증

- `node --import tsx --test test/user-shell.test.ts`: 5/5 PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- DevTools viewport audit: 375, 768, 1024, 1440 모두 `overflowX=0`
- 화면 증거: `개발환경_고도화/migration-control/evidence/web-user-portal-ui-20260910/`
- 운영 DB·운영 데이터·`feature/prod`·Gate 8: 변경 없음

## Gate 상태

- 기존 WEB 공유 통합 Gate 1~7 증거는 유지한다.
- 이 증분 UI 변경의 Gate 7은 구현·증거 작성에 참여하지 않은 독립 검토자가 확정한다.

# WEB-WBS-011B 현재 사용자 재화 UI 체크포인트

- mode: `WEB_PORTAL / UI_IMPLEMENT_VERIFY`
- catalog / delta: `SC-20260902-1` / `SCD-WEB-20260910-10`
- evidence schema: `web-current-player-currency-ui-v1`
- slice / Lease: `SL-CURRENCY-USER-WEB-BALANCE-READ-01` / `Lease2648`
- CONTROL: `5688` (scope expansion)
- branch / worktree: `feature/web-portal` / `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`

## 완료 범위

`/account/currencies`와 trailing slash shell route, 활성 재화 내비게이션, profile payload의 `currencyAccounts` read-only 렌더링, `point`/`diamond` Korean label 및 code fallback을 구현했다. 초대형 잔액은 문자열로 그대로 표시하며 로딩·빈 목록·조회 오류·세션 만료 상태, focus, aria-live, 375px 모바일 한 열 reflow를 포함한다.

## 변경 파일

- `개발환경_고도화/runtime/src/site-web/user-shell-assets.ts`
- `개발환경_고도화/runtime/src/site-web/user-shell.ts`
- `개발환경_고도화/runtime/test/user-shell.test.ts`
- `개발환경_고도화/design-system/hoibot-portal/pages/currencies.md`
- `개발환경_고도화/migration-control/evidence/web-current-player-currency-ui-20260910/T1-ui-validation.md`

## 검증과 다음 행동

`user-shell.test.ts` 13/13, site-web wiring 1/1, typecheck, build, diff check이 통과했다. Gate 7은 독립 검수자 검증이 필요하며 Gate 8은 운영 준비 wave까지 FALSE로 유지한다. Sheets에는 쓰지 않았다.

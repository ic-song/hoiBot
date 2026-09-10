# WEB-WBS-011D 현재 사용자 분류 가방 UI 체크포인트

- mode: `WEB_PORTAL / READ_UI`
- validation tier: `T1`
- slice / Lease: `SL-ITEM-USER-WEB-BAG-CATEGORY-UI-01` / `Lease2652`
- catalog delta: `SCD-WEB-20260910-13` (provider input은 `SCD-WEB-20260910-12`)
- evidence schema: `web-current-player-bag-category-ui-v1`
- branch / worktree: `feature/web-portal` / `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- base: `512db10f`
- evidence: `개발환경_고도화/migration-control/evidence/web-current-player-bag-category-ui-20260910/`

## 구현 범위

`/account/inventory`에 일반 가방·가구가방 탭, 명시적 category 조회, 분류별 loading/empty/error/pagination 문구와 세션 만료 정리를 구현한다. 기존 일반 가방 행과 상단 포인트·다이아 잔액을 보존하고, 가구 행에는 이름·등급·매력도·수량 1만 표시한다. 내부 ID, 이름 기반 분류 추정, 다른 typed 응답의 빈 상태 위장은 허용하지 않는다.

## Gate 상태

- Gate 1: 기존 일반 UI와 WEB-WBS-011C provider 계약 재확인.
- Gate 2: category, 응답 discriminant, 공개 필드, pagination, auth 경계 확정.
- Gate 3: 일반 회귀, 가구 정상·빈·오류·세션 만료·페이지·mismatch fixture 작성.
- Gate 4: UI와 접근성 구현.
- Gate 5: 실제 category provider 서비스와 같은 입력을 사용한 browser Shadow 및 shell/API 통합 검증 완료.
- Gate 6: focused 19/19, typecheck, build, diff-check, 4개 viewport overflow 0 확인.
- Gate 7: `FALSE`; 구현·evidence 작성자와 분리된 독립 검토가 남아 있다.
- Gate 8: `FALSE`; 운영 준비 wave 범위 밖이다.

Gate 1~6 evidence는 준비됐다. 커밋·push 뒤 Gate 7 독립 검토만 요청한다.

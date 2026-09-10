# WEB-WBS-016A 도메인 카탈로그 메뉴 checkpoint

- 실행: `개발자-WEB-WBS-016A-20260910-menu`
- Lease: `Lease2669`
- branch/worktree: `feature/web-portal` / `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- baseline: `a5cc210443d6fbba3a40435eb29e632a1d7b1a6d`
- catalog/delta/schema: `SC-20260902-1` / `SCD-WEB-20260910-22` / `web-admin-domain-object-catalog-menu-v1`
- profile/tier: `READ_UI` / `T1`
- 상태: Gate1~6 TRUE, Gate7~8 FALSE

## 완료

- 5개 도메인 카탈로그 메뉴, URL deep link, history 복원, active 상태를 구현했다.
- 다이아상점·펫스킬 전용 API/UI 흐름과 패키지·설정 메뉴를 보존했다.
- 아이템·가구·미니펫은 폼 없는 독립 준비 화면으로 제한했다.
- 일반 운영 셸에서 범용 오브젝트 메뉴·편집기·임시 예시 값을 제거했다.
- 직접 접근 route, focused 31개 테스트, typecheck, build, 4개 viewport 브라우저 검증과 diff check를 통과했다.

## 변경 자원

- `개발환경_고도화/runtime/src/admin/web-shell-assets.ts`
- `개발환경_고도화/runtime/src/admin/web-shell.ts`
- `개발환경_고도화/runtime/test/admin-web-shell.test.ts`
- `개발환경_고도화/runtime/test/admin-domain-object-catalog-menu.test.ts`
- `개발환경_고도화/migration-control/evidence/web-admin-domain-object-catalog-menu-20260910/**`
- `.codex/checkpoints/WEB-WBS-016A-domain-object-catalog-menu.md`

## 남은 위험

- 아이템·가구·미니펫 전용 조회·변경은 식별 규칙과 원본 연결 규칙, 전용 API 승인 전까지 차단한다.
- 브라우저 검증용 서버에 펫스킬 조회 fixture가 없어 전용 오류 상태가 표시됐다. 전용 API 계약 회귀 4개는 통과했다.
- Gate 7은 구현·evidence 작성자가 아닌 독립 검수자가 수행해야 하며 Gate 8은 범위 밖이다.

중앙 Sheets, 운영 데이터, DB/migration, `app.ts`, provider, `feature/prod`, Gate 8은 변경하지 않았다.

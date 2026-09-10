# WEB-WBS-016A 도메인 카탈로그 메뉴 검증

- Lease: `Lease2669`
- 기준선: `a5cc210443d6fbba3a40435eb29e632a1d7b1a6d`
- catalog/delta/schema: `SC-20260902-1` / `SCD-WEB-20260910-22` / `web-admin-domain-object-catalog-menu-v1`
- 실행 profile/tier: `READ_UI` / `T1`

## 구현 결과

- 카탈로그 내비게이션에 다이아상점, 펫스킬, 아이템, 가구, 미니펫을 각각 표시하고 독립 URL과 active 상태를 연결했다.
- 패키지 카탈로그와 설정 카탈로그 메뉴를 유지했다.
- 다이아상점과 펫스킬은 기존 전용 API·UI 변경 흐름을 그대로 사용한다.
- 아이템, 가구, 미니펫은 별도 화면에서 준비 중 빈 상태만 표시하며 등록·수정 폼을 만들지 않았다.
- 범용 오브젝트 메뉴와 원시 키·형식·JSON·원본 입력 편집기 및 임시 예시 값을 운영 셸에서 제거했다. 백엔드 범용 route는 변경하지 않았다.
- 5개 직접 접근 URL과 trailing slash URL은 새로고침해도 같은 보안 관리자 셸을 반환한다.

## 검증 결과

- Focused: `node --import tsx --test test/admin-web-shell.test.ts test/admin-domain-object-catalog-menu.test.ts test/admin-diamond-catalog-web-consumer.test.ts test/admin-pet-skill-catalog-web-consumer.test.ts` — 31 passed, 0 failed.
- Typecheck: `npm run typecheck` — PASS.
- Build: `npm run build` — PASS.
- Chrome: 375, 768, 1024, 1440px에서 `overflowX=0`, 표시된 버튼 최소 높이 44px, 아이템 active 메뉴와 heading 일치, 폼 0개를 확인했다.
- Deep link: 다섯 URL 모두 직접 접근과 active heading 일치를 확인했다. 다이아상점 success, 펫스킬 error, 아이템·가구·미니펫 empty 상태를 실제 화면에서 확인했다.
- `git diff --check` — PASS.

## Gate 1~6

Gate 1~6은 위 코드·focused test·브라우저 근거로 TRUE다. Gate 7 독립 검수와 Gate 8 운영 준비는 FALSE다.

아이템·가구·미니펫 전용 조회·변경은 식별 규칙과 원본 연결 규칙, 전용 API가 승인될 때까지 제공하지 않는다. 운영 데이터, DB, migration, 중앙 Sheets, `feature/prod`는 변경하지 않았다.

# WEB-WBS-016A 도메인별 오브젝트 관리 UX readiness checkpoint

- 실행: `개발자-WEB-WBS-016A-20260910`
- Lease: `Lease2667`
- branch/worktree: `feature/web-portal` / `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- baseline: `3dc59c41b8a0f8e5959d5f7c5cdb474a182b72c5`
- catalog/delta/schema: `SC-20260902-1` / `SCD-WEB-20260910-21` / `web-admin-domain-object-catalog-ux-readiness-v1`
- profile/tier: `SHARED_PROVIDER` / readiness `T0`
- 상태: `PARTIAL EXTENSION`, Gate1~2 TRUE, Gate3~8 FALSE

## 확정 사실

- `currency.lease2374_credit`와 화면의 canonical source는 Lease2374 합성 fixture다.
- `127.0.0.1` 미리보기 제출은 프로세스 내부 Map만 변경하며 MariaDB에 저장되지 않는다.
- 실제 app의 generic POST는 transaction 안에서 object registry/source/alias/change log와 operations/audit/outbox를 실제 저장한다.
- 현재 generic UI는 raw objectKey/type/metadata/source를 운영자가 작성하게 하므로 운영 UI로 부적합하다.
- 다이아상점과 펫스킬은 전용 API/provider/menu를 재사용한다.
- 아이템·가구·미니펫은 목록 projection부터 분리하고, 등록 mutation은 각 동결 identity/source resolver 승인 전 시작하지 않는다.
- 패키지는 기존 전용 메뉴, 타이틀은 별도 WBS로 유지한다.

## 후속 순서

1. `WEB-WBS-016A1` T1: 5개 메뉴와 deep link를 만들고 generic raw 등록 폼·합성 placeholder를 운영 UI에서 제거한다.
2. `WEB-WBS-016A2` T1: ITEM/FURNITURE/MINI_PET canonical 정의와 object link를 읽는 domain allowlist 목록 API를 추가한다.
3. item/furniture/mini-pet stable key와 canonical source crosswalk를 독립 검토한다.
4. `WEB-WBS-016A3` T2: opaque definitionRef만 받아 서버가 key/type/source/metadata를 생성하는 mutation facade를 구현한다.
5. transaction, same-key/different-payload/restart replay, version conflict, audit/outbox rollback, MariaDB Shadow, 4 viewport를 검증한다.

## 중요한 차단

- ITEM은 여러 동결 key 규칙을 사용하므로 `item.<code>` 단순 생성 금지.
- FURNITURE 기존 source `petSweetHomeInfo.furnitureDraw`와 current generic allowlist가 불일치.
- MINI_PET 기존 source `miniPetData.miniPet`와 current generic allowlist가 불일치하며 key가 source index 기반.
- 위 세 문제를 단순 allowlist 확장이나 클라이언트 raw 입력으로 우회하지 않는다.

## evidence

- `개발환경_고도화/migration-control/evidence/web-admin-domain-object-catalog-ux-readiness-20260910/validation.md`
- `개발환경_고도화/migration-control/evidence/web-admin-domain-object-catalog-ux-readiness-20260910/summary.json`

운영 DB, 운영 데이터, source/test/DB/migration, 중앙 Sheets, `feature/prod`, Gate8은 변경하지 않았다.

# WEB-WBS-016A 카탈로그 메뉴 독립 Gate 7 재검토

- 재검토 대상 commit: `ada9652fa5f4908a0d2cf2b9b329b258b479a161`
- 보정 기준선: `2b6e97fe1466e74b6071097ce7bac65c18ed64a1`
- 재검토 Lease: `Lease2675`
- 검토자 역할: 보정 구현자, 기능 owner, 보정 evidence 작성자가 아닌 독립 검토자
- execution profile / validation tier: `READ_UI` / `T1`
- catalog_version: `SC-20260902-1`
- delta_id: `SCD-WEB-20260910-22`
- evidence_schema_version: `web-admin-domain-object-catalog-menu-gate7-rereview-v1`

`catalog_version`, `delta_id`, `evidence_schema_version`은 서로 다른 식별자로 기록했으며 기존 evidence를 재라벨링하지 않았다.

## 발견 사항

- P0: 0건
- P1: 0건
- P2: 0건

기존 독립 검토에서 확인한 P1은 재현되지 않았다. Chrome exact viewport에서 상품 추가 확인 checkbox는 작은 input이 아니라 실제 클릭 가능한 가장 가까운 `label.checkbox-field`의 bounding box로 측정했다. 375·768·1440px에서 label 높이가 각각 44px였고, 1024px에서 상품 비활성화 버튼 너비가 정확히 44px였다. 모든 표시된 유효 조작 대상은 너비와 높이 양쪽에서 44px 이상이었다.

| viewport | 보정 확인 대상 | 독립 재측정 유효 클릭 영역 | 결과 |
|---:|---|---:|---|
| 375px | 상품 추가 확인 checkbox wrapper label | `313.6 × 44.0px` | PASS |
| 768px | 상품 추가 확인 checkbox wrapper label | `678.4 × 44.0px` | PASS |
| 1024px | 상품 추가 확인 checkbox wrapper label | `266.4 × 58.4px` | PASS |
| 1024px | 상품 비활성화 버튼 | `44.0 × 65.6px` | PASS |
| 1440px | 상품 추가 확인 checkbox wrapper label | `333.0 × 44.0px` | PASS |

## 독립 검증 결과

| 검토 항목 | 결과 | 근거 |
|---|---|---|
| Git 기준선 | PASS | 재검토 시작 시 `feature/web-portal`의 HEAD와 `origin/feature/web-portal`이 exact `ada9652f...`였고 worktree가 clean이었다. |
| 보정 diff와 범위 | PASS | `2b6e97fe...ada9652f`는 checkpoint 1개, 보정 evidence 3개, `web-shell-assets.ts`, focused test 1개만 변경했다. source 변경은 `.checkbox-field`의 `min-height: 44px`와 `.danger-button`의 `min-width: 44px`뿐이다. app, provider, DB, migration, 운영 데이터, Sheets, `feature/prod`, Gate 8은 변경하지 않았다. |
| 기존 기능 보존 | PASS | 메뉴 구성, deep link, 다이아상점·펫스킬 전용 흐름, 아이템·가구·미니펫 준비 화면의 동작 변경이 보정 diff에 없다. |
| 메뉴 순서와 기존 메뉴 | PASS | Chrome 20/20에서 카탈로그 메뉴가 `다이아상점 → 펫스킬 → 아이템 → 가구 → 미니펫 → 패키지 카탈로그 → 설정 카탈로그` 순서로 유지됐다. |
| deep link shell | PASS | focused test에서 다섯 기본 경로와 다섯 trailing slash 경로가 10/10 HTTP 200, 동일 secured shell, `cache-control: no-store`를 반환했다. Chrome은 다섯 기본 경로를 각각 직접 GET해 로그인 세션과 새로고침 경계를 통과했다. |
| URL·active·heading·history | PASS | Chrome 20/20에서 exact pathname, `aria-current="page"`, 상단 h1과 본문 h2가 해당 도메인과 일치했다. focused test에서 pathname 복원, `pushState`, `popstate` 뒤로가기 계약이 통과했다. |
| 범용 오브젝트 UI 제거 | PASS | Chrome 20/20에서 `오브젝트 카탈로그`, `Object key`, `Object type`, `Metadata JSON`, `Canonical source`, `currency.lease2374_credit`, `lease2374_credit` 노출이 각각 0건이었다. 등록·수정·active 범용 폼도 0건이며 generic backend route는 보정 diff 0이다. |
| 전용·준비 화면 | PASS | 다이아상점은 전용 success와 상품 추가 폼 1건, 펫스킬은 전용 error UI와 폼 0건, 아이템·가구·미니펫은 각각 별도 empty 준비 화면과 폼 0건이었다. 세 준비 화면에는 가짜 성공이나 mutation 조작이 없었다. |
| 전용 흐름·보안 회귀 | PASS | 다이아상점·펫스킬 전용 route, RBAC fail-closed, CSRF, idempotency, 확인·사유, decimal-string version 계약이 focused 및 admin 회귀에서 통과했다. |
| focused test | PASS | 지정 4개 파일 `31/31` 통과, fail·skip 0. |
| admin regression | PASS | 비통합 `admin-*.test.ts` `138/138` 통과, fail·skip 0. generic object consumer 회귀를 포함한다. |
| typecheck / build / diff | PASS | `npm run typecheck`, `npm run build`, `git diff --check 2b6e97fe...ada9652f`가 모두 통과했다. |
| Chrome responsive matrix | PASS | exact 375·768·1024·1440px × 5 path, 총 20/20에서 URL, active, heading, overflow 0, visible focus, 유효 조작 대상 최소 44×44px가 모두 통과했다. |
| 키보드 focus | PASS | 20/20에서 실제 `Shift+Tab` 입력 후 로그아웃 버튼이 focus를 받았고 화면 안에서 `solid 2.4px` outline을 표시했다. |
| 운영 자산·Gate 8 | PASS | 운영 데이터·DB·migration·provider·Sheets·`feature/prod`를 건드리지 않았으며 Gate 8은 FALSE로 유지한다. |

## Chrome 5 path × 4 viewport 결과

Chrome CDP device metrics를 적용하고 각 측정 전에 `window.innerWidth`가 정확히 375, 768, 1024, 1440px인지 확인했다. 조작 대상은 현재 viewport와 교차하며 display·visibility·opacity 조건을 통과한 `button`, `a[href]`, `input`, `select`, `textarea`, `[role=button]`이다. checkbox input은 중복 계산하지 않고 실제 클릭 가능한 wrapper label의 bounding box로 대체했다.

| 경로 | 375 | 768 | 1024 | 1440 | 표시 form 수 | 화면 상태 |
|---|---|---|---|---|---:|---|
| `/admin/catalog/diamond-shop` | PASS, min `44×44` | PASS, min `44×44` | PASS, min `44×44` | PASS, min `56.65×44` | 1 | success |
| `/admin/catalog/pet-skills` | PASS, min `44×44` | PASS, min `44×44` | PASS, min `76.49×44` | PASS, min `76.49×44` | 0 | error UI |
| `/admin/catalog/items` | PASS, min `44×44` | PASS, min `44×44` | PASS, min `76.49×44` | PASS, min `76.49×44` | 0 | empty |
| `/admin/catalog/furniture` | PASS, min `44×44` | PASS, min `44×44` | PASS, min `76.49×44` | PASS, min `76.49×44` | 0 | empty |
| `/admin/catalog/mini-pets` | PASS, min `44×44` | PASS, min `44×44` | PASS, min `76.49×44` | PASS, min `76.49×44` | 0 | empty |

- 20/20: exact viewport, pathname, active menu, `aria-current="page"`, h1·h2, `overflowX=0`.
- 20/20: 실제 키보드 포커스가 화면에 보이고 focus outline이 유지됐다.
- 20/20: 모든 표시된 유효 조작 대상의 너비와 높이가 각각 44px 이상이었다.
- 20/20: 금지된 범용 오브젝트 UI·placeholder가 각각 0건이었다.
- 다이아상점은 전용 success, 아이템·가구·미니펫은 각자 독립 empty 화면이었다.
- 펫스킬의 `error UI`는 synthetic preview support가 `/api/v1/admin/pet-skill-catalog` fixture endpoint를 제공하지 않아 나타난 전용 오류 화면이다. 제품 endpoint·RBAC·CSRF·idempotency 계약은 pet-skill focused 4/4와 전체 admin regression에서 별도로 통과했다. preview 환경 한계를 제품 결함으로 세지 않았다.

## 실행 명령

```powershell
node --import tsx --test test/admin-web-shell.test.ts test/admin-domain-object-catalog-menu.test.ts test/admin-diamond-catalog-web-consumer.test.ts test/admin-pet-skill-catalog-web-consumer.test.ts
$adminTestFiles = Get-ChildItem -LiteralPath 'test' -File -Filter 'admin-*.test.ts' | Where-Object { $_.Name -notlike '*.integration.test.ts' } | ForEach-Object { $_.FullName }
node --import tsx --test $adminTestFiles
npm run typecheck
npm run build
git diff --check 2b6e97fe1466e74b6071097ce7bac65c18ed64a1..ada9652fa5f4908a0d2cf2b9b329b258b479a161
```

브라우저 검증은 운영 데이터나 운영 endpoint를 사용하지 않고 `test/support/admin-web-shell-preview.ts`의 synthetic Fastify 앱을 `127.0.0.1:4177`에서 실행해 실제 Chrome으로 확인했다.

## Gate 7 판정

**GO**

기존 P1 보정은 exact Chrome 20/20에서 독립 재현 검증을 통과했다. 기능 범위, 메뉴·deep link, 금지 범용 UI 제거, 전용 흐름과 보안 계약, 준비 화면, 회귀·typecheck·build·diff에도 열린 P0/P1/P2가 없다. Gate 7은 TRUE로 판정하며 Gate 8은 FALSE로 유지한다.

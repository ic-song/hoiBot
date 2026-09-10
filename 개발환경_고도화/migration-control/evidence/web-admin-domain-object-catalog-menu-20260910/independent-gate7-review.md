# WEB-WBS-016A 카탈로그 메뉴 독립 Gate 7 검토

- 검토 대상 commit: `ba7a4db67bb82c0264c9d84a8c3d4fa3fc47a67c`
- 구현 기준선: `a5cc210443d6fbba3a40435eb29e632a1d7b1a6d`
- 검토 Lease: `Lease2671`
- 검토자 역할: 구현자, 기능 owner, Gate 1~6 evidence 작성자가 아닌 독립 검토자
- execution profile / validation tier: `READ_UI` / `T1`
- catalog_version: `SC-20260902-1`
- delta_id: `SCD-WEB-20260910-22`
- evidence_schema_version: `web-admin-domain-object-catalog-menu-gate7-review-v1`

`catalog_version`, `delta_id`, `evidence_schema_version`은 서로 다른 식별자이며 기존 Gate 1~6 evidence schema를 재라벨링하지 않았다.

## 발견 사항

- P0: 0건
- P1: 1건
- P2: 0건

### P1 — 다이아상점 화면의 표시된 조작 대상이 44×44px 수용 기준을 충족하지 않는다

실제 Chrome synthetic preview에서 다이아상점 화면의 표시된 조작 대상을 너비와 높이 양쪽으로 측정했다. 체크박스는 작은 input 자체가 아니라 클릭 가능한 가장 가까운 `label.checkbox-field`의 bounding box를 사용했다.

| viewport | 대상 | 실제 유효 클릭 영역 | 결과 |
|---:|---|---:|---|
| 375px | 상품 추가 확인 checkbox wrapper label | `313.6 × 41.6px` | 높이 미달 |
| 768px | 상품 추가 확인 checkbox wrapper label | `678.4 × 41.6px` | 높이 미달 |
| 1024px | 상품 비활성화 버튼 | `39.7 × 65.6px` | 너비 미달 |
| 1440px | 상품 추가 확인 checkbox wrapper label | `333.0 × 41.6px` | 높이 미달 |

이번 변경은 일반 버튼 최소 높이를 44px로 올렸지만 `.checkbox-field`의 실제 높이는 41.6px이고, `.danger-button`에는 44px 최소 너비가 없어 1024px 표 안에서 39.7px까지 수축한다. 요청된 `visible interactive min 44px` acceptance를 충족하지 않으므로 Gate 7을 통과시킬 수 없다.

수정 제안은 `.checkbox-field`에 실제 clickable area 기준 `min-height: 44px`를 적용하고, `.danger-button`에 `min-width: 44px; min-height: 44px` 및 필요한 수축 방지 규칙을 적용한 뒤 같은 20개 조합을 다시 측정하는 것이다. 독립 검토자는 source를 수정하지 않았다.

## 독립 검증 결과

| 검토 항목 | 결과 | 근거 |
|---|---|---|
| Git 기준선 | PASS | `feature/web-portal`, HEAD와 `origin/feature/web-portal`이 모두 exact `ba7a4db6...`였고 검토 시작 시 worktree가 clean이었다. |
| 변경 범위 | PASS | 대상 commit은 관리자 shell asset·shell route 2파일, 관련 test 2파일, task checkpoint·evidence 4파일만 변경했다. `app.ts`, backend generic object route, DB, migration, provider, 운영 data, 중앙 Sheets는 변경하지 않았다. |
| 메뉴 순서와 기존 메뉴 | PASS | `다이아상점 → 펫스킬 → 아이템 → 가구 → 미니펫`이 같은 카탈로그 그룹에 연속 배치됐고 뒤의 `패키지 카탈로그`, `설정 카탈로그`가 유지됐다. |
| deep link shell | PASS | 다섯 `/admin/catalog/...` 경로와 각각의 trailing slash 경로가 10/10 HTTP 200, 동일 `ADMIN_WEB_HTML`, `cache-control: no-store`를 반환했다. 실제 Chrome은 각 기본 경로에 직접 진입한 뒤 synthetic 로그인 세션을 유지했다. |
| URL·active·heading | PASS | Chrome 20/20 조합에서 pathname, `aria-current="page"` 메뉴, 상단 heading이 대상 도메인과 일치했다. source의 `pushState`, `popstate`, pathname 복원 로직과 focused history 계약도 유지됐다. |
| 범용 오브젝트 UI 제거 | PASS | 20/20 화면에서 `오브젝트 카탈로그`, `Object key/type`, `Metadata JSON`, `Canonical source`, `currency.lease2374_credit`, `lease2374_credit` 노출이 0건이었다. 범용 object backend route source는 대상 diff 0이며 독립 admin 회귀에서 기존 계약을 통과했다. |
| 폼 범위 | PASS | 다이아상점은 기존 전용 상품 추가 폼 1건, 펫스킬·아이템·가구·미니펫은 0건이었다. 아이템·가구·미니펫은 mutation 없이 각자 별도 empty 준비 화면을 표시했다. |
| 전용 흐름·보안 회귀 | PASS | 다이아상점·펫스킬의 전용 route, RBAC fail-closed, CSRF, idempotency, decimal-string version 계약이 focused test와 admin 회귀에서 통과했다. |
| focused test | PASS | 지정 4개 파일 `31/31` 통과, fail·skip 0. |
| admin regression | PASS | 비통합 `admin-*.test.ts` `138/138` 통과, fail·skip 0. generic object consumer 회귀도 포함한다. |
| typecheck / build / diff | PASS | `npm run typecheck`, `npm run build`, `git diff --check HEAD^ HEAD` 모두 통과했다. |
| Chrome responsive matrix | **FAIL** | 정확한 375·768·1024·1440px × 5 path에서 URL/active/heading과 overflow는 통과했으나 위 P1의 44×44px 미달을 재현했다. |
| 키보드 focus | PASS | 20/20 조합에서 실제 `Shift+Tab` 입력 후 로그아웃 버튼이 focus를 받았고 visible `solid 2.4px` outline을 표시했다. |
| 운영 자산·Gate 8 | PASS | 운영 데이터·DB·migration·provider·Sheets·`feature/prod`를 건드리지 않았으며 Gate 8은 FALSE로 유지한다. |

## Chrome 5 path × 4 viewport 결과

모든 viewport는 CDP mobile device metrics를 사용해 `window.innerWidth`가 정확히 375, 768, 1024, 1440px인지 확인한 뒤 측정했다.

| 경로 | 375 | 768 | 1024 | 1440 | form 수 | 화면 상태 |
|---|---|---|---|---|---:|---|
| `/admin/catalog/diamond-shop` | active/heading PASS, overflow 0, target FAIL | active/heading PASS, overflow 0, target FAIL | active/heading PASS, overflow 0, target FAIL | active/heading PASS, overflow 0, target FAIL | 1 | success |
| `/admin/catalog/pet-skills` | PASS | PASS | PASS | PASS | 0 | error UI |
| `/admin/catalog/items` | PASS | PASS | PASS | PASS | 0 | empty |
| `/admin/catalog/furniture` | PASS | PASS | PASS | PASS | 0 | empty |
| `/admin/catalog/mini-pets` | PASS | PASS | PASS | PASS | 0 | empty |

- 20/20: 정확한 URL, active menu, heading, `overflowX=0`, 금지 generic UI 0건.
- 20/20: 실제 키보드 포커스가 화면에 보이고 focus outline이 유지됐다.
- 16/20: 모든 표시 조작 대상의 유효 클릭 영역이 너비·높이 모두 44px 이상이었다.
- 4/20: 다이아상점에서 위 P1의 44px 미달이 있었다.
- 펫스킬의 `error UI`는 preview support에 `/api/v1/admin/pet-skill-catalog` fixture endpoint가 없어 전용 오류 화면과 `다시 시도` 버튼이 표시된 결과다. 제품의 전용 API 계약은 focused 4/4와 전체 admin regression에서 별도로 통과했으므로 endpoint 부재 자체를 제품 결함으로 세지 않았다.

## 실행 명령

```powershell
node --import tsx --test test/admin-web-shell.test.ts test/admin-domain-object-catalog-menu.test.ts test/admin-diamond-catalog-web-consumer.test.ts test/admin-pet-skill-catalog-web-consumer.test.ts
$adminTestFiles = Get-ChildItem -LiteralPath 'test' -File -Filter 'admin-*.test.ts' | Where-Object { $_.Name -notlike '*.integration.test.ts' } | ForEach-Object { $_.FullName }
node --import tsx --test $adminTestFiles
npm run typecheck
npm run build
git diff --check HEAD^ HEAD
```

브라우저 검증은 운영 데이터나 운영 endpoint를 사용하지 않고 `test/support/admin-web-shell-preview.ts`의 synthetic Fastify 앱을 `127.0.0.1`에서 실행해 Chrome으로 확인했다.

## Gate 7 판정

**NO-GO**

기능 범위, 메뉴·deep link, 금지 범용 UI 제거, 전용 흐름 보존, empty 준비 화면, 회귀·build·diff는 통과했다. 그러나 다이아상점의 표시된 조작 대상이 exact viewport 4개 모두에서 요청된 44×44px 최소 클릭 영역을 충족하지 않아 P1 1건이 남아 있다. Gate 7만 FALSE로 판정하며 Gate 8도 FALSE로 유지한다.

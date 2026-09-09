# WEB-WBS-012 관리자 MVP 재사용 evidence 독립 Gate 7 검토

- 검토 대상: `7322878d130514d9ad37a0f3ace7cefedd55f391`
- 작업 식별자: `WEB-WBS-012` / `Lease2640` / `SCD-WEB-20260910-4`
- evidence schema: `web-admin-reuse-evidence-v1`
- 검토자 역할: 구현 및 검증 evidence 작성에 참여하지 않은 독립 검토자
- 검토 방식: 커밋 diff, 현행 관리자 shell/assets/routes/auth, app 등록, 기존 Gate 7 evidence와 Lease 원장을 읽기 전용으로 확인하고 focused test·typecheck·build·diff 검사를 재실행

## 발견 사항

- P0: 없음
- P1: 없음
- P2: 없음

## 독립 검증 결과

| 검토 항목 | 결과 | 근거 |
|---|---|---|
| focused test | PASS | `admin-web-shell.test.ts`, `admin-authorization.test.ts`, `site-web-app-wiring.test.ts`를 함께 재실행해 16/16 통과, 실패·skip 0을 확인했다. |
| typecheck / build / diff | PASS | `npm run typecheck`, `npm run build`, `git diff --check 7322878d^ 7322878d`가 모두 통과했다. |
| shell 등록 단일성 | PASS | `app.ts`의 `registerAdminWebShellRoutes` import와 호출이 각각 1건이며, `/admin`, `/admin/`, CSS, JS 경로는 한 registrar에만 정의되어 있다. |
| session·REST 등록 단일성 | PASS | `app.ts`의 `registerAdminRoutes` import와 호출이 각각 1건이다. session lifecycle과 관리자 read route는 이 단일 registrar를 사용한다. |
| RBAC | PASS | 현행 `readAuthorization`은 역할 기본 권한을 만든 뒤 개인 deny를 제거하고 개인 allow를 추가한다. focused test에서 역할 권한 중 deny 대상이 제거되고 별도 allow가 추가되는 결과와 `requirePermission`의 403 경로를 확인했다. |
| 금지 endpoint | PASS | 관리자 client asset에서 `server-assignment`, `player-assignment`, `/operators`, `/passes`를 독립 검색해 각각 0건이었다. 서버에 존재하는 관리자 mutation route가 이번 재사용 UI에 노출되지 않는다. |
| 기존 Gate 7 연결 | PASS | `admin-web-shell-read/slice.json`은 Gate 1~7, focused 6/6, typecheck/build, source commit `7e607975`, 운영 DB·prod 미접촉을 기록한다. `admin-web-mvp-integration/slice.json`은 Gate 1~7, focused latest 44/44, full regression 1270/1270, schema/provider 변경 0, 운영 DB 미사용, Gate 8 false를 기록한다. `summary.json`과 `validation.md`의 연결 값이 원본과 일치한다. |
| evidence-only 범위 | PASS | 대상 커밋은 checkpoint, `summary.json`, `validation.md` 세 파일만 추가했다. 관리자 source/test 및 `app.ts` 변경은 0이다. evidence의 `sourceHead=ba74e66...`은 대상 evidence 커밋 직전 검증 기준선과 일치한다. |
| Lease 충돌 | PASS | `슬라이스_선점` 2638·2640행을 직접 재조회했다. Lease2638과 Lease2640의 공통 key는 `R:FILE:hoibot/개발환경_고도화/runtime/src/app.ts`뿐이고 R/R 중첩이다. 다른 Lease2638 쓰기 자원과 Lease2640 쓰기 자원은 겹치지 않는다. |
| 운영 자원·Gate 8 | PASS | 대상 commit에 DB, migration, provider, ledger, receipt, 운영 data 변경이 없다. `origin/feature/prod`에 대상 commit이 포함되지 않았고 기존 두 Gate 7 원본과 이번 evidence 모두 Gate 8을 false로 유지한다. |

## 실행 명령과 조회

```powershell
git show --stat --oneline 7322878d
git diff-tree --no-commit-id --name-only -r 7322878d
git diff --check 7322878d^ 7322878d
git merge-base --is-ancestor 7322878d origin/feature/prod
node --import tsx --test test/admin-web-shell.test.ts test/admin-authorization.test.ts test/site-web-app-wiring.test.ts
npm run typecheck
npm run build
```

추가로 `app.ts`에서 두 registrar의 import·호출 횟수를 정규식으로 각각 계산하고, `web-shell-assets.ts`의 금지 endpoint 네 패턴을 각각 검색했다. Google Sheets `슬라이스_선점!A2638:N2640`을 읽기 전용으로 조회해 두 ACTIVE Lease의 resource key를 대조했다.

## 한계와 후속 범위

- 이번 항목은 기존 관리자 MVP를 재사용할 수 있는지 확인하는 evidence-only 작업이다. 브라우저 desktop/mobile, 실제 401/403·만료 session, empty/retry, CSP/no-store, console, restart/replay/rollback 및 최종 Shadow는 기록된 대로 `WEB-WBS-015` 통합 검증 범위다.
- 운영 DB와 운영 데이터에는 접근하지 않았다. 기존 Gate 7 근거와 현재 synthetic/focused 검증을 연결했으며 Gate 8 운영 승인을 대신하지 않는다.

## Gate 7 판정

**GO**

현행 관리자 shell, session, read API와 RBAC provider는 단일 등록 구조를 유지한다. 관리자 client에 금지 mutation endpoint가 없고, 현재 커밋은 기존 구현을 바꾸지 않은 evidence-only 변경이다. 현재 focused test·typecheck·build·diff와 기존 두 Gate 7 원본의 연결, Lease R/R 병행 조건이 모두 확인됐다.

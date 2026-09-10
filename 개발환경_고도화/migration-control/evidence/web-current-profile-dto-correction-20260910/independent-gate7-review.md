# WEB-WBS-010 current-profile DTO 교정 독립 Gate 7 검토

- 검토 대상: `b51754890ae857b8dd71c852a83ac4d2a42e762c`
- 원격 검증: `HEAD == origin/feature/web-portal == b51754890ae857b8dd71c852a83ac4d2a42e762c`
- claim / CONTROL: `Lease2643` / `슬라이스_보고수신!5670`
- delta / schema: `SCD-WEB-20260910-6` / `web-current-profile-dto-correction-v1`
- 검토자 역할: 구현 및 evidence 작성에 참여하지 않은 독립 검토자
- 검토 범위: target commit diff, 현행 `ProfileView`와 repository projection, focused test, typecheck, build, diff check, checkpoint/evidence 및 CONTROL/Lease 원장

## 발견 사항

- P0: 없음
- P1: 없음
- P2: 없음

## 독립 검증 결과

| 검토 항목 | 결과 | 근거 |
|---|---|---|
| 실제 `ProfileView` 필드 | PASS | `ProfileView`와 MariaDB projection의 `displayName`, 문자열 `level`, `accumulatedLevel`, `server: { code, displayName } | null` 계약을 사용자 셸이 정확히 소비한다. |
| 표시 결과 | PASS | 닉네임은 `displayName`, 누적 레벨은 `accumulatedLevel`, 서버명은 `server.displayName`을 사용한다. server 객체를 문자열로 노출하지 않으며 표시명이 없으면 server code를 사용한다. |
| 기존 alias fallback | PASS | `nickname`, `name`, `playerName`, `serverName`, 문자열형 `server` fallback이 실제 DTO 우선순위 뒤에 유지되어 있다. focused fixture는 실제 DTO를 실행하고 alias 보존은 target diff와 client source를 정적으로 교차 확인했다. |
| self-scope | PASS | 기존 `/api/v1/player-profiles/current`만 호출하며 player ID나 외부 target을 입력받지 않는다. route는 현재 인증 session의 player ID로 repository를 조회한다. 새 endpoint와 mutation은 0이다. |
| session 만료·민감정보 초기화 | PASS | profile 조회 401은 `/login`으로 이동해 session·CSRF·profile state와 계정 표시·profile list를 초기화하고 가시 notice에 focus를 둔다. focused test가 해당 경로를 확인한다. |
| 접근성 | PASS | 변경 값은 기존 `dl/dt/dd` 구조에 `textContent`로 들어가며 keyboard·screen reader 구조를 바꾸지 않는다. 로그인 접근성 및 만료 notice focus test도 통과했다. |
| focused test | PASS | `node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts`: 7/7 통과, 실패·skip 0. |
| typecheck / build / diff | PASS | `npm run typecheck`, `npm run build`, `git diff --check` 모두 통과했다. target commit의 `git diff --check b5175489^ b5175489`도 통과했다. |
| target 고정 | PASS | 검토한 구현·테스트·evidence가 `b5175489...`에 고정됐고 원격 `feature/web-portal`과 exact다. commit은 대상 source·test와 checkpoint·evidence 다섯 파일만 포함한다. |
| Lease·CONTROL 교정 | PASS | 동시 append 충돌 후 실제 웹 claim은 `슬라이스_선점` 2643행으로 고정됐다. CONTROL5670이 분기된 5668·5669를 모두 supersede하고 Lease2642=WBS797, Lease2643=WEB-WBS-010, SCD-6 pending 및 상호 W 자원 비중첩을 명시한다. claim 2643행에도 `canonical_lease_id=Lease2643`, `authoritative_control=...!5670`이 기록되어 있다. |
| 범위 이탈 | PASS | target commit에 `app.ts`, user-auth routes, provider, DB, migration, 운영 data 변경이 없다. `feature/prod` 반영과 Gate 8도 수행하지 않았다. 현재 별도 Lease2641의 inventory working-tree 변경은 target commit에 포함되지 않으며 대상 파일과 겹치지 않는다. |

## 독립 실행 명령과 원장 조회

```powershell
git rev-parse HEAD
git rev-parse origin/feature/web-portal
git show --stat --oneline b5175489
git diff-tree --no-commit-id --name-only -r b5175489
git diff --check b5175489^ b5175489
node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts
npm run typecheck
npm run build
```

Google Sheets `슬라이스_선점!A2643:N2643`과 `슬라이스_보고수신!A5670:N5670`을 읽기 전용으로 재조회해 claim 및 supersede 체인을 검산했다. 실제 DTO 계약은 `runtime/src/player/profile.ts`, `runtime/src/player/maria-profile-repository.ts`, `runtime/src/user-auth/routes.ts`와 대조했다.

## 한계

- alias fallback은 source에서 보존됨을 독립 확인했지만 focused fixture는 실제 API DTO를 우선 검증하므로 legacy alias만을 별도로 실행하는 test는 없다.
- 운영 DB·운영 데이터와 Gate 8은 이번 T1 UI 교정 범위가 아니며 접근하지 않았다.

## Gate 7 판정

**GO**

실제 current-profile DTO가 화면에 정확히 표시되고 server 객체 노출 문제가 제거됐다. self-scope, session 만료, 민감정보 초기화와 접근성 회귀가 유지되며 focused 7/7, typecheck, build, diff 검사가 통과했다. 동시 append로 생긴 Lease·CONTROL 충돌도 CONTROL5670과 Lease2643으로 교정됐고 target commit 및 원격 branch가 exact다.

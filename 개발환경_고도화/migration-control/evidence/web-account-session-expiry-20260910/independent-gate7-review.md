# WEB-WBS-009 세션 만료 가시 상태 독립 Gate 7 검토

- 검토 대상: `eea9bdcae84feda38315a0a34690c006fa3f25b0`
- 작업 식별자: `WEB-WBS-009` / `Lease2639` / `SCD-WEB-20260910-3`
- evidence schema: `web-account-session-expiry-v1`
- 실행 프로필 / 검증 티어: `READ_UI` / `T1`
- 검토자 역할: 구현 및 evidence 작성에 참여하지 않은 독립 검토자
- 검토 방식: 읽기 전용 diff·코드·evidence·PNG 확인과 focused test·회귀 test·typecheck 재실행

## 발견 사항

- P0: 없음
- P1: 없음
- P2: 없음

## 독립 검증 결과

| 검토 항목 | 결과 | 근거 |
|---|---|---|
| 401 세션 만료 처리 | PASS | current profile 조회, session refresh, logout 처리의 401 경로가 `showLogin(..., true)`로 수렴한다. `showLogin`은 `state.csrfToken`, session, profile을 초기화하고 `clearSensitiveView()`를 호출한다. |
| 민감 표시 초기화 | PASS | 로그인 ID, 내부 account/player ID, 시스템 계정명, 플레이어 이름·서버 등 계정 화면 표시를 `—`로 초기화하고 프로필 목록과 앱 오류를 숨긴다. |
| `/login` 이동 | PASS | `window.history.replaceState({}, "", "/login")`로 주소를 교체하고 login view를 활성화한다. |
| 가시 notice와 접근성 | PASS | notice는 `role="status"`, `tabindex="-1"`을 갖고 있으며 만료 메시지를 표시한 뒤 programmatic focus를 받는다. 공통 `:focus-visible` 윤곽선과 충분히 구분되는 notice 배경·테두리·문자색이 정의되어 있다. |
| 첫 미로그인과 만료 구분 | PASS | 최초 session 복원 401은 `showLogin("로그인이 필요합니다.")`로 notice를 노출하지 않는다. 인증 이후 만료 401은 `visibleNotice=true`로 별도 만료 문구를 노출한다. |
| API 및 mutation 범위 | PASS | 기존 `/api/v1/sessions/current`, `/api/v1/player-profiles/current`, 기존 로그인·로그아웃 흐름만 사용한다. 이번 delta에 production API나 mutation을 추가하지 않았다. |
| 반응형 evidence | PASS | 375/768/1024/1440 총 4건 모두 `/login`, `activeView=login`, `noticeVisible=true`, `focusedId=login-session-notice`, `sensitiveCleared=true`, `overflowX=0`, `pass=true`이다. |
| PNG 무결성·시각 검토 | PASS | 네 PNG의 SHA-256을 `summary.json`과 독립 대조해 4/4 일치했다. 375 및 1440을 포함한 화면에서 notice 가독성, 레이아웃, 수평 넘침 결함을 발견하지 않았다. |
| focused test | PASS | `node --import tsx --test test/user-shell.test.ts`: 6/6 통과. |
| web regression | PASS | `node --import tsx --test test/user-shell.test.ts test/account-platform-challenge.test.ts test/account-platform-schema.test.ts`: 16/16 통과. |
| typecheck | PASS | `npm run typecheck`: 통과. |
| build·diff evidence | PASS | `summary.json`과 checkpoint에 build PASS가 기록되어 있고 `git diff --check eea9bdca^ eea9bdca`도 독립 실행해 통과했다. 변경 커밋과 원격 `feature/web-portal` HEAD가 일치한다. |
| 제외 자원 | PASS | commit 변경 목록에 `app.ts`, DB, migration, provider, ledger, receipt가 없다. `eea9bdca`는 `origin/feature/prod`에 포함되지 않아 운영 반영 및 Gate 8 범위를 건드리지 않았다. |

## 실행 명령

```powershell
git rev-parse HEAD
git rev-parse origin/feature/web-portal
git show --stat --oneline eea9bdca
git diff-tree --no-commit-id --name-only -r eea9bdca
git diff --check eea9bdca^ eea9bdca
git merge-base --is-ancestor eea9bdca origin/feature/prod
node --import tsx --test test/user-shell.test.ts
node --import tsx --test test/user-shell.test.ts test/account-platform-challenge.test.ts test/account-platform-schema.test.ts
npm run typecheck
```

PNG는 각 파일의 SHA-256을 다시 계산해 `summary.json`의 `screenshotSha256`과 대조했다.

## 한계

- `npm run build`는 산출 파일을 만들 수 있어, 이 독립 검토에서 허용된 “보고서 파일 외 수정 금지”를 지키기 위해 재실행하지 않았다. 대신 커밋에 포함된 build PASS evidence, 독립 typecheck, focused·회귀 test, diff 무결성을 교차 확인했다.
- 실제 만료는 evidence audit의 preview server로 재현되었다. 운영 인증 공급자나 운영 세션에 대한 검증은 Gate 8 범위이며 이번 검토에 포함하지 않았다.

## Gate 7 판정

**GO**

세션 만료 시 인증·CSRF 상태와 민감 표시가 초기화되고, 사용자는 `/login`의 가시 notice로 이동하며 해당 notice에 focus가 놓인다. 최초 미로그인과 만료 상태가 구분되고, 변경은 기존 읽기·세션 API 계약 안에 머문다. 반응형 evidence, PNG hash, focused·회귀 test, typecheck와 diff 근거가 현재 커밋과 일치한다.

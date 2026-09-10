# WEB-WBS-011B 현재 사용자 재화 UI T1 증거

- Lease: `Lease2648`
- CONTROL: `5688` scope-expansion 연결
- slice / delta: `SL-CURRENCY-USER-WEB-BALANCE-READ-01` / `SCD-WEB-20260910-10`
- evidence schema: `web-current-player-currency-ui-v1`
- 범위: `/account/currencies`, user shell assets·route·harness test·설계 문서

## 계약과 UI 동작

`GET /api/v1/player-profiles/current`의 기존 `profile.currencyAccounts`를 로그인 뒤 한 번 읽어 재사용한다. 새 API·provider·인증·DB 호출은 추가하지 않았다. `point`와 `diamond`는 각각 `포인트`, `다이아`로 표시하며 나머지 코드는 원문 fallback으로 표시한다. `balance`는 `Number`로 변환하지 않고 `textContent`에 문자열로 넣는다.

로딩·빈 목록·profile 조회 오류를 화면별로 표시한다. profile 또는 후속 화면 조회의 `401`은 기존 `showLogin`·`clearSensitiveView`로 이동해 재화 목록, 카운트, 상태를 지운다. 내비게이션은 활성 링크와 `aria-current="page"`를 제공하고, route 진입 때 제목으로 포커스를 옮기며 상태 변화는 기존 polite live region으로 알린다.

## 자동 검증

2026-09-10, `개발환경_고도화/runtime`에서 다음을 통과했다.

1. `node --import tsx --test test/user-shell.test.ts` — 13/13 통과. `/account/currencies`와 trailing slash route, 초대형 decimal 문자열 보존, Korean/fallback label, 빈 목록, 기존 401 민감 DOM 정리를 포함한다.
2. `node --import tsx --test test/site-web-app-wiring.test.ts` — 1/1 통과.
3. `npm run typecheck` — 통과.
4. `npm run build` — 통과.
5. `git diff --check` — 통과.

## 반응형·접근성 시각 QA

CSS source QA로 375/768/1024/1440 폭을 확인했다. 375px 이하에서는 `.currency-item`을 한 열로 전환하고 큰 잔액과 fallback 코드는 `min-width: 0` 및 `overflow-wrap: anywhere`로 컨테이너 안에서 줄바꿈한다. 620px 이상은 기존 셸 grid, 820px 이상은 224px sidebar와 `minmax(0, 1fr)` main column을 사용한다. 링크는 최소 46px, UI 버튼은 기존 최소 44px 이상이고 focus-visible outline 및 reduced-motion 규칙을 재사용한다. 수평 스크롤을 만드는 고정 폭·숫자 변환은 추가하지 않았다.

Gate 7은 독립 검수자가 확정해야 하며, Gate 8 운영 준비는 이 UI subclaim 범위 밖이다.

## CONTROL5690 후속: 상단 현재 잔액

로그인 뒤 모든 주요 화면의 헤더에 `point`와 `diamond` 잔액을 compact summary로 표시했다. 기존 profile payload만 재사용하며 초대형 잔액도 원문 문자열 그대로 보인다. summary는 profile 응답 전·로그인 화면·세션 만료·로그아웃에서 숨기고 내부 텍스트도 비운다. 좁은 화면에서는 header와 summary가 wrap하며 잔액에는 `overflow-wrap: anywhere`를 적용한다. `user-shell.test.ts`는 14/14 통과했고 상단 표시, huge string, logout clear, profile 401 clear를 검증한다.

병행 Lease2649가 `50b5f176`으로 오류를 해소하고 원격에 반영된 뒤 작업반장이 전체 검증을 다시 실행했다. `user-shell.test.ts` 14건과 `site-web-app-wiring.test.ts` 1건, 합계 15/15가 통과했고 `npm run typecheck`, `npm run build`, `git diff --check`도 모두 통과했다. 검증 시점의 `feature/web-portal` HEAD는 `50b5f176`이며 Lease2648 구현 `91440b47`과 상단 잔액 후속 `04297e5c`를 포함한다.

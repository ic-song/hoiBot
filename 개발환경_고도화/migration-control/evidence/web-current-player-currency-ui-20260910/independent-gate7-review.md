# WEB-WBS-011B Gate 7 독립 검토

- 판정: **GO**
- 검토 대상: `WEB-WBS-011B` / `SL-CURRENCY-USER-WEB-BALANCE-READ-01` / `Lease2648`
- 검토자 독립성: 구현(`91440b47`, `04297e5c`)과 제출 증거(`817e7c94`)의 작성·소유자가 아닌 검토자가 수행했다.
- 구현 기준 commit: `91440b47b702c992c20f435a96690d31a19ca7e2`
- 사용자 지시 보완 commit: `04297e5c53cfa7060a97dcae0feee87d2508a16e`
- 제출 증거 commit / 원격 HEAD: `817e7c9404c8cf8261b3e28a9d36ebc18c29429b`
- provider dependency: `0135d902b19a60a705162abc37fd92005f03c037`
- 병행 Lease2649 구현: `50b5f1764a8595766b58e661612ce54365d379c3`
- 기준: `SC-20260902-1` / `SCD-WEB-20260910-10` / `web-current-player-currency-ui-v1`
- Gate 8: `FALSE`. 운영 DB/data, `feature/prod`, migration은 검토·변경 범위 밖이다.

## 원장·범위 대조

`슬라이스_보고수신!5690`은 상단 잔액 보완을 승인한 CONTROL이며 이후 CONTROL로 supersede되었다. 라이브 원장의 최신 non-superseded CONTROL은 `슬라이스_보고수신!5694`이다. 이 CONTROL은 `Lease2648`, object recovery `Lease2650`, bag-category provider `Lease2651`만 ACTIVE로 열거하고, `Lease2649`는 `HANDOFF_READY`로 기록한다. CONTROL5694와 각 Lease 행은 Lease2648/2649/2650/2651 사이 W resource overlap이 없음을 명시한다.

`슬라이스_선점!2648`의 write 범위는 `user-shell-assets.ts`, `user-shell.ts`, `user-shell.test.ts`, currencies 설계 문서, 이 evidence 디렉터리, checkpoint, `/account/currencies` route와 `WEB-WBS-011B`이다. profile/auth/provider 입력과 currency DB object는 R-only이며 `app.ts`, 신규 API/provider, auth write, DB/migration write, 운영 DB/data, `feature/prod`, Gate 8은 명시적으로 제외된다. target diff는 이 파일·증거 범위 안에 머문다.

Lease2649는 관리자 account-link backend로서 `HANDOFF_READY`, Gate1~6 TRUE, Gate7/8 FALSE다. 이번 UI의 구현은 그 backend의 route/service/test 또는 `app.ts`를 변경하지 않는다. Lease2650은 WBS798 title-list object recovery이며 Lease2646의 exact resource만 승계하고 Lease2648·2649와 no-overlap이다. 따라서 현재 UI Gate 7 검토는 해당 병행/후속 Lease의 terminal 또는 active 상태를 변경하지 않는다.

## 독립 검증

- `user-shell.ts`는 `/account/currencies`와 `/account/currencies/`를 기존 shell로 연결한다. client route guard도 같은 direct/trailing path를 인정하며 canonical URL로 정규화한다.
- UI는 기존 `GET /api/v1/player-profiles/current`의 `profile.currencyAccounts`만 읽는다. source와 테스트에서 `/api/v1/currencies`, admin API, 새 provider/route가 없음을 확인했다.
- provider dependency `0135d902`의 기존 profile contract는 active, undeleted current player와 active currency definition만 반환한다. UI는 임의 player selector를 만들지 않고 session/profile payload를 재사용한다.
- 재화 이름은 `point`→`포인트`, `diamond`→`다이아`, 그 밖에는 code 원문 fallback이다. `balance`는 `String(...)`으로 `textContent`에 넣으며 재화 값을 `Number`, `parseInt`, `parseFloat`, `BigInt`로 변환하지 않는다. 파일의 `Number(...)` 호출은 기존 가방 pagination 흐름에만 있다. 매우 큰 decimal 문자열과 `7.000` 보존은 focused harness로 확인했다.
- `renderHeaderBalances`는 point/diamond만 프로필에서 찾아 로그인된 모든 shell section의 header에 표시한다. `clearSensitiveView`와 `showLogin`은 목록·상태·header summary와 두 잔액 텍스트를 모두 비우고 숨긴다. profile/session 401은 이 흐름으로 전환된다.
- loading, empty, error UI는 별도 요소와 `aria-busy`, status/error semantics로 분리된다. 활성 nav에는 `aria-current="page"`가 적용되고 route 전환 시 title로 focus를 옮기며 live region으로 안내한다.
- `.currency-item`과 잔액/코드는 `min-width: 0` 및 `overflow-wrap:anywhere`를 사용한다. 375px 이하에는 한 열 reflow, 620px 이상에는 shell grid, 820px 이상에는 `224px minmax(0, 1fr)` shell layout이다. container도 `min(...)`/`calc(...)`이며 이 기능이 수평 overflow를 만드는 고정 폭을 추가하지 않았다. header summary도 wrap과 narrow-screen `max-width:100%`를 가진다.
- `HEAD`, local `feature/web-portal`, `origin/feature/web-portal`은 모두 `817e7c94`이고 worktree는 review 파일을 만들기 전 clean이었다. `0135d902`와 `50b5f176`은 모두 review HEAD의 조상이다. target/evidence diff와 `git diff --check`에서 whitespace 오류가 없다.

## 독립 재실행

```text
node --import tsx --test test/user-shell.test.ts
tests 14, pass 14, fail 0

node --import tsx --test test/site-web-app-wiring.test.ts
tests 1, pass 1, fail 0

npm run typecheck
PASS

npm run build
PASS

git diff --check 91440b47^..817e7c94
PASS
```

현재 source SHA-256:

- `runtime/src/site-web/user-shell-assets.ts`: `c881cf1633c324c73bdeab322dfc4757d9099d32b1dab81cdcfbc4c1d68f3d3e`
- `runtime/src/site-web/user-shell.ts`: `ac5175c51ff0da97bf870eeb5316e4e8b6e39cfd36e3a696702510bfa6e00cbe`
- `runtime/test/user-shell.test.ts`: `b68b7f62929b977cfc070c734039016c8293b7eda85562c7e90bbeb8c32802aa`

첫 hash는 제출된 foreman visual QA의 target source hash와 일치한다.

## Findings

- P0: 없음
- P1: 없음
- P2: 네 viewport에 대해 별도 authenticated browser screenshot을 이번 독립 검토에서 새로 생산하지는 못했다. committed foreman QA에는 실제 1440px browser 확인이, T1 evidence와 source/harness에는 375/768/1024/1440의 reflow·overflow 근거가 있다. 이는 재현된 결함이 아니라 visual-evidence depth의 한계다. 다음 portal integration/Shadow에서 네 viewport의 fresh capture를 함께 남긴다.

## Gate 7 결론

새 API/provider/DB가 추가되지 않았고, current-player self scope와 active currency provider contract를 그대로 소비한다. 큰 decimal 문자열, header/session clearing, route wiring, state UI, accessibility, responsive source rule, claim self-scope, Git lineage와 provider dependency가 독립 점검과 재실행에서 일치한다. P0/P1은 없으므로 **Gate 7 GO**다. P2 visual-evidence follow-up과 Gate 8 운영 준비는 별도 wave에서 처리한다.

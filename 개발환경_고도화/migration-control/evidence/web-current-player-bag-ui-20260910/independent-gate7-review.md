# WEB-WBS-011A 가방 UI 독립 Gate 7 검토

- 최초 검토 대상: `7c73ff87e61cab3596aff9df82d02a66581076b5`
- 최종 재검토 대상: `e37c9702bae177347693af9cfa4a5024c47de973`
- Lease / CONTROL: `Lease2644` / `슬라이스_보고수신!5675` (`ACTIVE`, row5674 superseded)
- delta / evidence schema: `SCD-WEB-20260910-7` / `web-current-player-bag-ui-v1`
- 검토 역할: 구현 및 기존 evidence 작성에 참여하지 않은 독립 검토자
- 최종 판정: **Gate 7 NO-GO / UI subclaim HANDOFF_READY**
- 남은 조건: 실제 API·provider 연결 및 same-input Shadow 검증

## 결론

`e37c9702`에서 최초 검토의 UI 구현·증거 P1/P2는 해소됐다. `/account/inventory` shell route, mock 계약 소비, 세션 만료와 data clear, pagination, 안전한 DOM 렌더링, 키보드·live region, exact 반응형 증거는 독립 재검증을 통과했다. UI subclaim은 실제 consumer 통합 단계로 넘길 수 있는 `HANDOFF_READY` 상태다.

다만 이 커밋에는 `app.ts` API 등록, 실제 provider 연결과 same-input Shadow가 없다. 이 제한은 Lease2644 범위와 evidence에 정확히 기록되어 있으며, 전체 WEB-WBS-011A의 Gate 7을 TRUE로 올릴 수 없으므로 현재 Gate 7 판정은 `NO-GO`다.

## P0 / P1 / P2

### P0

- 없음.

### P1

1. **실제 consumer 통합 및 same-input Shadow PENDING.** 현재 화면은 mock `GET /api/v1/inventory/current?limit=<1..100>&offset=<0..>` 계약까지만 검증됐다. 실제 `app.ts` route 등록, provider 응답 연결, 동일 입력 Shadow를 후속 integration claim에서 확인해야 한다. 완료 전 Gate 7은 FALSE를 유지한다.

### P2

- 없음.

## 독립 재검증

- `HEAD`와 `origin/feature/web-portal`은 모두 `e37c9702bae177347693af9cfa4a5024c47de973`으로 exact였다.
- `git diff --check e37c9702^ e37c9702`: PASS.
- `node --import tsx --test test/user-shell.test.ts`: 11/11 PASS.
- `node --import tsx --test test/site-web-app-wiring.test.ts`: 1/1 PASS. focused 합계 12/12 PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `responsive-metrics.json`: viewport 4건, schema `web-responsive-metrics-v1`, CDP mobile emulation, `deviceScaleFactor=1` 확인.
- 375×812, 768×900, 1024×900, 1440×900 모두 요청 width/height와 `innerWidth`/`innerHeight`가 exact이고, body/document scrollWidth도 viewport width와 같으며 `horizontalOverflow=false`다.
- 네 viewport 모두 inventory visible, itemCount 8, active nav `page`, focus `inventory-title`, live status `가방 항목 8개를 표시합니다.`, long quantity visible이 기록됐다.
- JSON의 `user-shell-assets.ts` SHA-256 `4a083f344abbcbaa3f99c06c519b7b4802b04bd2216e1d711ddeefda05081a36`과 현재 파일 hash가 일치했다.
- JSON의 `user-shell.ts` SHA-256 `d1187c7275962ab3487dc172f5fc67684bfb4089008b54b1b5a9d23248018822`와 현재 파일 hash가 일치했다.

## 기능·보안·접근성 확인

- `/account/inventory` 및 trailing slash route와 가방 내비게이션이 shell에 한 번 등록되고 활성 링크에 `aria-current=page`가 설정된다.
- mock API는 limit/offset pagination을 사용하며 이전/다음 버튼 상태를 provider pagination에 맞춰 갱신한다.
- 항목명과 unsigned 64-bit 수량 문자열은 `textContent`로 생성된다. `innerHTML`, browser storage, Authorization header, admin API 사용은 추가되지 않았다.
- loading, empty, 일반 오류, retry 성공, bag endpoint 401, profile endpoint 401을 focused test가 다룬다.
- 프로필 401은 `loadProfile()`이 `false`를 반환하며, 호출자가 가방 fetch를 시작하지 않는다. 로그인 전환 뒤 CSRF/session/profile/inventory state와 inventory DOM이 비어 있는 경로를 검증했다.
- 가방 endpoint 401도 `showLogin()`을 통해 표시 데이터와 상태를 지우고 만료 안내로 이동한다.
- 제목 focus, `aria-busy`, status/alert, 44px pagination target, reduced-motion 및 모바일 2열 pagination 재배치를 확인했다.
- 빈 가방과 성공 조회의 최종 live announcement가 별도 일반 문구로 덮이지 않는다.

## 최초 지적의 해소

- 프로필 401 뒤 가방 요청 지속: `e37c9702`에서 후속 요청을 차단하고 회귀 test를 추가해 해소.
- 375/768/1024/1440 대신 확대된 innerWidth를 사용한 증거: exact CDP 측정과 source hash가 있는 `responsive-metrics.json`으로 해소.
- 빈 값·일반 오류·재시도 focused evidence 부족: 동적 회귀 test 추가로 해소.
- 성공 직후 live announcement 덮어쓰기: 가방 route의 중복 일반 announcement 제거로 해소.

## 범위와 한계

- `e37c9702`의 변경은 UI assets/test/checkpoint/evidence에 한정되며 `app.ts`, API/provider, DB/migration, 운영 데이터, ledger/receipt, `feature/prod`, Gate 8을 수정하지 않았다.
- 시각 증거는 작업반장의 CDP 관찰 기록과 source hash가 결합된 기계 판독 JSON을 독립 검증했다. 본 검토자가 별도 PNG를 재생성하지는 않았다.
- 후속 consumer/integration Gate에서 실제 API 응답과 mock DTO의 일치, 인증 self-scope, provider comparator/pagination, same-input Shadow를 확인한 뒤에만 Gate 7을 재판정해야 한다.

# WBS801 Wave34 타이틀 선택 보정 체크포인트

- slice: `SL-MEMBER-TITLE-LEGACY-SELECT-PARITY-01`
- execution / Lease: `WBS801-TITLE-SELECT-CORRECTION-20260910` / `Lease2673`
- catalog / delta / schema: `SC-20260902-1` / `SCD-OBJ-20260910-34` / `object-db-consumer-delta-v1`
- implementation commit: `c448ef838aaeffc5c552eacce6383af550e1194f`
- evidence-input commit: `7c63144411a7aa2fd96080710d78d7673dc315b2`
- consumers: `legacy-9cd62419b853c929`, `runtime-dispatch-d9a426f3b9d18d3a`
- 운영 데이터·운영 DB·3306·`feature/prod`·Gate 8: 변경하지 않음

## 구현과 실제 실행 근거

- `PlayerTitleSelectService.select()`의 transaction 첫 query가 활성 `guild_territory_wars` 행을 잠그며, 활성 전쟁이 있으면 actor·operation·title·outbox보다 먼저 `null`을 반환한다.
- `buildApp`은 nullable 결과에 reply를 추가하지 않는다.
- 결과 envelope `PLAYER_TITLE_SELECT_RESULT_V1`은 command identity와 정규화된 선택 번호의 SHA-256을 보존한다. 동일 event와 동일 payload만 재생하며, 번호가 달라지거나 raw 구형 결과이면 `PLAYER_TITLE_SELECT_PAYLOAD_DRIFT`로 rollback한다.
- exact duplicate와 새 service instance restart replay는 business DML 0이다. 동시 동일 event는 한 writer만 title 두 테이블을 갱신한다. 감사 실패는 두 갱신을 rollback한다.
- committed `main.js` 분기와 actual service/buildApp를 실행했다. success, overflow digit, malformed, member missing, title index missing, siege no-reply를 비교했다.

## `/타이틀 0` 감사 정정

선행 후보 감사의 `0 -> title_not_found` 설명은 committed source와 달랐다. 실제 레거시는 `list.length >= 0`을 통과한 뒤 `list[-1].name`에서 `TypeError`가 발생한다. `response(...)` 최상위 catch는 일반 명령 오류를 기록하고 reply하지 않으며 `saveJsonFile`도 호출되지 않는다. 신규 경로는 이 관찰 가능한 계약을 안전하게 `NO_REPLY`, business DML 0으로 보존한다. overflow digit는 `title_not_found`, malformed 입력은 사용법 응답이다.

## 누적 결과

- receipt: `401 + 12 = 413`
- DIRECT / EQUIVALENT / proven: `59 / 12 / 71`
- STATIC_ONLY / BLOCKED_DYNAMIC: `980 / 82`
- residual: `1,062` (`C_DIRECT_EXECUTION=980`, `D_PREREQUISITE=82`)
- MEMBER-TITLE residual: `14`
- ledger entrySet SHA-256: `b35b9e1f659b4704aeed3a146642e213c3254c5f70f4c54eb62dc5d0bd0bafe5`

## 파일 봉인

| 파일 | bytes | SHA-256 |
|---|---:|---|
| Wave34 receipt bundle | 2,085,513 | `221f750cd8f0109a54fb46d2cf5df69abfe0be26ae92b1bc275e1d7e21ae3f4e` |
| cumulative ledger | 5,054,248 | `83d6fbd34eab2c04e8e3f00e73b444d9d3d04574319fb6bfcfc0318b0aca7d43` |
| residual plan | 4,960,070 | `97f48ec9ea2c3d7e44c641cd17be62bba4dced13ea099284fb9e1df950e29f75` |
| Wave34 fixture | 10,991 | `76175f66cc9ecc198fa60b7ab1641e6691bdac91a2e34b60a6b2c8f0ba70ed84` |
| Wave34 delta | 3,025 | `4d3d0550f304fcc88277fc29e4e4da319ffffc54d2ee53b12a39ac742e2e9f5d` |

## 검증

- actual focused, schema, cumulative: `13/13 PASS`
- Wave30~34 + residual + title focused: `33/33 PASS`
- strict AJV receipt/ledger + deterministic rebuild: `PASS`
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`
- synthetic fake DB만 사용. 외부 네트워크 호출과 운영 DB 접근 없음.

Gate 7 독립 검토와 Sheets 갱신은 작업반장 전용 후속 절차다.

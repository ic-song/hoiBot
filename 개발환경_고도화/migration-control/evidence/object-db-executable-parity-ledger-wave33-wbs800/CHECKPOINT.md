# WBS800 Wave33 완료 체크포인트

- 슬라이스: `SL-MEMBER-TITLE-ADMIN-GIFT-TICKET-GRANT-PARITY-01`
- 보정 Lease: `Lease2668`
- catalog/delta: `SC-20260902-1` + `SCD-OBJ-20260910-33`
- consumers: `legacy-bda1428003a5b522`, `runtime-dispatch-948bbf36d6af623a`
- 구현/evidence 입력 commit: `c80995907c472739e599412c38a2040aeb20b975`
- 운영 데이터·운영 DB·3306·`feature/prod`: 변경 없음
- Gate 8: 수행하지 않음

## 구현

`AdminStackGrantService.grant()`는 정규화된 command(`amount`, `targetLegacyKey`)와 definition identity(`commandCode`, `itemCode`, `itemName`, `idempotencyScope`, `actionCode`, `reasonCode`)의 SHA-256을 결과 envelope에 저장한다. 같은 eventId의 정확한 요청은 저장 결과를 반환하며 business DML은 0이다. 수량·대상·definition이 달라지면 `ADMIN_STACK_GRANT_PAYLOAD_DRIFT`로 rollback한다. unique idempotency 경합은 한 번 재조회하여 확정된 저장 결과만 반환한다.

과거 raw `result_json`에는 원 요청 지문이 없어 동일 요청인지 증명할 수 없다. 이를 새 envelope로 추정 변환하지 않고 `ADMIN_STACK_GRANT_PAYLOAD_DRIFT`로 fail closed한다. 이 정책은 과거 eventId의 자동 재실행보다 중복 지급 방지를 우선한다.

## 실제 실행 행렬

committed `main.js`와 actual `buildApp → TitleGiftTicketGrantService.grant → AdminStackGrantService.grant`를 사용했다. 두 consumer는 각각 고유 harness case, scenario ID, receipt ID를 가진다.

- `MUTATION_SUCCESS`: 동일 `/타이틀2, 합성 대상` reply와 수량 2
- `DOMAIN_FAILURE_ROLLBACK`: audit 실패 후 수량·business DML 0
- `DUPLICATE_REPLAY_DML_ZERO`: 동일 eventId/동일 payload 저장 결과 반환, 추가 business DML 0
- `PAYLOAD_DRIFT_FAIL_CLOSED`: 동일 eventId의 amount/target 변경을 정확한 오류로 거부, 추가 business DML 0
- `RESTART_REPLAY`: 새 service instance에서 동일 저장 결과 반환, 추가 business DML 0
- `CONCURRENCY_SINGLE_WRITER`: 동시 두 호출 결과 동일, 지급은 한 번
- `AUTH_DENIED`: legacy와 runtime 모두 reply·business DML 0
- `WRONG_ROOM_REJECTED`: committed legacy source에 room/channel guard가 없어 `SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1` N/A

## 누적 결과

- receipts: `387 + 14 = 401`
- DIRECT: `57`, EQUIVALENT: `12`, proven: `69`
- STATIC_ONLY: `982`, BLOCKED_DYNAMIC: `82`
- residual: `1,064` (`C_DIRECT_EXECUTION=982`, `D_PREREQUISITE=82`)
- MEMBER-TITLE residual: `16`
- entrySet SHA-256: `a5ecac26e5fa03105a9fedaaaae05de1d84b54e20def64494970b27a3cd6fefa`
- receipt file: `2,046,025 bytes`, SHA-256 `6b433fced0cd7abddd14fb1eda81524a18c7badfd832c614be8030128ff8542e`
- receipt401 compact prefix: `1,674,239 bytes`, SHA-256 `cff9566698b0850b4151153ef4f1ad9901a92cf304f43c28f6d89d72dd6f8156`
- ledger SHA-256: `f38804324161691074763364071e8f8179f9959847ac4885676829316e0021b7`
- residual SHA-256: `908b626df04d5313b417515641ee31bf88aeb61dc745a111cc468ffd8dbf9961`

보존 prefix는 모두 이전 byte/SHA-256과 정확히 일치한다.

| count | bytes | SHA-256 |
|---:|---:|---|
| 243 | 970,854 | `e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97` |
| 324 | 1,260,829 | `72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb` |
| 352 | 1,361,204 | `70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b` |
| 362 | 1,382,594 | `5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373` |
| 372 | 1,485,238 | `f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546` |
| 382 | 1,588,071 | `df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506` |
| 387 | 1,639,915 | `59a43f463dd33b1945c7e5d16c7c9da632c2075bbad57852d1b1092da78b7bfb` |

## 검증

- Wave30~33 + residual + title focused: `23/23 PASS`
- strict ledger and receipt schema: exit `0`, `AJV2020_STRICT_PASS`
- deterministic ledger rebuild/validation: `PASS`
- shared `AdminStackGrantService` command-boundary regression: `18/18 PASS`
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`
- diff scope/whitespace: `PASS`

변경 범위는 승인된 `admin-stack-grant-service.ts`, Wave33 fixture/harness/target/test/evidence, SCD-aware ledger validator/build scripts, cumulative receipt/ledger/residual, 그리고 누적 기대값을 읽는 Wave30~32/residual 테스트뿐이다.

Gate 1~6 증거가 완성됐다. Gate 7은 독립 검토자가 이 구현과 evidence를 검토한 뒤 판정한다.

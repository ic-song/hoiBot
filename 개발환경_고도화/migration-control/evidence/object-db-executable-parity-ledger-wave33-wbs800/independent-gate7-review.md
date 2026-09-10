# WBS800 독립 Gate 7 검토

- 판정: `GO`
- findings: `P0=0`, `P1=0`, `P2=0`
- 검토 Lease: `Lease2670`
- 슬라이스: `SL-MEMBER-TITLE-ADMIN-GIFT-TICKET-GRANT-PARITY-01`
- 검토 입력 commit: `34738e38e1206681d82d022544914866d6e04b25`
- 구현 commit: `c80995907c472739e599412c38a2040aeb20b975`
- catalog/delta: `SC-20260902-1` + `SCD-OBJ-20260910-33`
- 검토자 역할: 구현·evidence 비작성 독립 검토자
- 운영 데이터·운영 DB·3306·`feature/prod`: 변경 없음
- Gate 8: 수행하지 않음

## 독립 검토 결과

`AdminStackGrantService.grant()`는 정규화한 command의 `amount`, `targetLegacyKey`와 definition의 `commandCode`, `itemCode`, `itemName`, `idempotencyScope`, `actionCode`, `reasonCode`를 SHA-256 지문으로 묶어 저장한다. 동일 eventId의 exact 요청은 저장 결과만 반환하고 추가 business DML을 만들지 않는다. 수량·대상 또는 지문에 포함된 definition identity가 달라지면 `ADMIN_STACK_GRANT_PAYLOAD_DRIFT`로 실패한다.

지문 이전 raw `result_json`은 원 요청과의 동일성을 증명할 수 없으므로 자동 변환하거나 재사용하지 않고 같은 오류로 fail closed한다. 이는 과거 결과를 추정해 중복 지급할 위험을 차단한다.

트랜잭션은 operations claim, 대상·아이템 잠금, inventory stack 변경, inventory ledger, outbox, command execution, audit, 저장 결과를 한 경계에서 처리한다. audit 실패 검증에서 수량과 business DML이 모두 원복됐다. `uq_operations_idempotency` 충돌만 한 번 재시도하고, 재시도 시 저장된 결과를 다시 읽어 지문을 검증한다. 다른 unique 오류는 재시도 대상으로 넓히지 않는다.

committed `main.js`의 `/타이틀,`·`/타이틀N,` 분기와 actual `buildApp → TitleGiftTicketGrantService.grant → AdminStackGrantService.grant` 경로를 확인했다. `legacy-bda1428003a5b522`와 `runtime-dispatch-948bbf36d6af623a`는 서로 다른 `harnessCaseId`, scenario ID와 receipt ID를 가지며 각 7개 DIRECT PASS receipt가 존재한다.

- `MUTATION_SUCCESS`
- `DOMAIN_FAILURE_ROLLBACK`
- `DUPLICATE_REPLAY_DML_ZERO`
- `PAYLOAD_DRIFT_FAIL_CLOSED`
- `RESTART_REPLAY`
- `CONCURRENCY_SINGLE_WRITER`
- `AUTH_DENIED`

committed legacy source의 해당 분기에는 room/channel guard가 없다. 따라서 `WRONG_ROOM_REJECTED`는 `SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1` 근거의 N/A가 맞다.

## 누적 무결성

- receipts: `401` (`387 + 14`)
- DIRECT: `57`
- EQUIVALENT: `12`
- proven: `69`
- STATIC_ONLY: `982`
- BLOCKED_DYNAMIC: `82`
- residual: `1,064` (`C_DIRECT_EXECUTION=982`, `D_PREREQUISITE=82`)
- MEMBER-TITLE residual: `16`
- entrySet SHA-256: `a5ecac26e5fa03105a9fedaaaae05de1d84b54e20def64494970b27a3cd6fefa`
- receipt file: `2,046,025 bytes`, SHA-256 `6b433fced0cd7abddd14fb1eda81524a18c7badfd832c614be8030128ff8542e`
- receipt401 compact prefix: `1,674,239 bytes`, SHA-256 `cff9566698b0850b4151153ef4f1ad9901a92cf304f43c28f6d89d72dd6f8156`
- ledger SHA-256: `f38804324161691074763364071e8f8179f9959847ac4885676829316e0021b7`
- residual SHA-256: `908b626df04d5313b417515641ee31bf88aeb61dc745a111cc468ffd8dbf9961`

기존 compact prefix를 독립 계산했으며 모두 정확히 보존됐다.

| count | bytes | SHA-256 |
|---:|---:|---|
| 243 | 970,854 | `e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97` |
| 324 | 1,260,829 | `72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb` |
| 352 | 1,361,204 | `70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b` |
| 362 | 1,382,594 | `5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373` |
| 372 | 1,485,238 | `f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546` |
| 382 | 1,588,071 | `df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506` |
| 387 | 1,639,915 | `59a43f463dd33b1945c7e5d16c7c9da632c2075bbad57852d1b1092da78b7bfb` |

## 독립 재검증

- Wave30~33 + residual + title focused: `23/23 PASS`
- 공유 `AdminStackGrantService` command-boundary: `25/25 PASS`
- strict ledger/receipt schema 및 결정적 ledger rebuild: `PASS`, `AJV2020_STRICT_PASS`
- `npm run typecheck`: `PASS`
- `npm run build`: `PASS`
- `git diff --check`: `PASS`
- 검토 전 입력 상태: `HEAD=origin=34738e38e1206681d82d022544914866d6e04b25`, clean

과거 Wave32 결함을 고정하는 `object-db-consumer-executable-parity-wave32-blocker.test.ts`는 수정 전 P1 재현용이므로 현행 완료 회귀 묶음에서 제외했다. 현행 Wave32 완료 테스트는 통과했다.

Gate 1~6 evidence와 Shadow 근거가 현재 commit에 연결되어 있으며, Gate 7을 승인한다. Gate 8은 별도 운영 승인 전까지 미완료로 유지한다.

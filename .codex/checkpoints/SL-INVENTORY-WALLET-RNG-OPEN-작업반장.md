# SL-INVENTORY-WALLET-RNG-OPEN 체크포인트

- 실행 ID: `작업반장-SL-INVENTORY-WALLET-RNG-OPEN-20260830T030141`
- 기준: hoiBot `v2.400`, source contract `a286279b`, 구현 base `ffa782be`
- 명령: `/지갑털기`, `/지갑털기 [숫자]`
- Gate: G1~G7 `TRUE`, G8 `FALSE`
- Legacy: `main.js`, `Info.js` 변경 없음

## 확정 계약

- 1차 RNG: 빈 지갑 70%, 성공 30%
- 성공 내부 RNG: 82%, 14%, 3.5%, 0.4%, 0.09%, 0.01%
- 지급 포인트: 10,000,000 / 30,000,000 / 50,000,000 / 100,000,000 / 300,000,000 / 1,000,000,000
- 기본 1회, 0 입력은 1회, 요청량은 현재 재고까지 처리
- 일괄 결과는 지급액 내림차순, 10줄 이후 allsee
- 캐슬 공성 활성 중 무응답·무변경

## 검증

- focused unit: 4/4 PASS
- typecheck: PASS
- build: PASS
- full regression: 1,129 tests / 1,122 PASS / 0 FAIL / 7 SKIP
- migration: 001~377 중 367개 첫 적용, 재실행 367개 유지
- isolated MariaDB: `hoibot_wallet_rng_001`, port `33457`
- rollback, deterministic two-stage RNG, inventory/currency atomicity, same-event concurrency, ordered batch output: PASS
- MariaDB restart PID `4584`, stored replay additional mutation `false`
- operational data touched: `false`

## 다음 단계

- Gate8은 운영 snapshot import·대사, backup/restore, 승인된 실운영방 smoke, cutover 승인 전까지 `FALSE`로 유지합니다.

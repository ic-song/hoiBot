# SL-GUILD-SHOP-PURCHASE-01

- 실행 ID: `작업반장-SL-GUILD-SHOP-PURCHASE-01-RECOVERY-202609011540`
- 기준선: `7e680d2eb0aa98bdd0a8327da123fb57f5428719`
- 명령어: `/길드상점구매`
- migration: `427_guild_shop_purchase.sql`
- Gate: Gate1~Gate7 완료, Gate8 대기

## 구현 경계

- 기존 길드상점 카탈로그 순번과 canonical `item_definitions` 연결을 소비합니다.
- 포인트 차감, 재고 지급, 일일 구매 한도, 세금 15% 길드자금/85% 행복재단 적립을 한 트랜잭션에서 처리합니다.
- canonical 길드 통화 코드는 `guild_fund`만 사용합니다.
- operation, currency/inventory/guild ledger, command execution/audit, outbox를 함께 기록합니다.

## 검증

- focused: 2/2 PASS
- typecheck: PASS
- build: PASS
- fresh MariaDB: migration 409개 및 migration427 PASS
- MariaDB: purchase/tax/replay/rollback/reconnect/Shadow 1/1 PASS
- full: 1,370 total, 1,363 pass, 0 fail, 7 skip

## 금지 범위

- Gate8, feature/prod, 운영 DB 변경 없음
- legacy `main.js`, `Info.js`, `data/` 변경 없음
- 자산 카탈로그 Lease2477 파일과 겹침 없음

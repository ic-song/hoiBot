# 작업 체크포인트

- 작업 키: iteminfo-territory-tickets
- 작업 이름: itemInfo 영지 공격·방어권 6개 typed 정의
- 작업 상태: Gate1~7 검증 완료, WBS 마감 대기
- 마지막 갱신: 2026-08-30 16:18 KST
- 슬라이스: `SL-ASSET-ITEMINFO-TERRITORY-TICKETS-01`
- 실행 ID: `작업반장-SL-ASSET-ITEMINFO-TERRITORY-TICKETS-01-202608301559`
- Lease: 2344 ACTIVE
- baseline: `959d8bf7`
- branch: `codex/modernization-iteminfo-territory-tickets-v2400-20260830`
- worktree: `C:\Users\user\Desktop\hoiBot-worktrees\iteminfo-territory-tickets-v2400-20260830`

## 범위

- `castlePremiumItem.offense` 3행과 `defense` 3행을 scope+source key identity로 정의한다.
- 표시 확률과 원천 `successRate`를 별도 typed 필드로 보존한다.
- exact canonical `ITEM-TERRITORY-DEFENSE-50`만 재사용하고 나머지 5개는 신규 stable code를 사용한다.
- 기존 inventory ownership/ledger를 재사용한다.

## 금지 범위

- `main.js`, `Info.js`, 운영 JSON, 운영 DB, `feature/prod`, Gate8 변경 금지.
- 이름만 같은 항목의 자동 병합 금지.

## 검증 결과

- focused test: 5/5 PASS
- typecheck/build: PASS
- full regression: 1,176 total / 1,169 pass / 0 fail / 7 skip
- fresh MariaDB: `127.0.0.1:33457/hoibot_iteminfo_territory_387_01`
- migration: 377개 적용, `387_iteminfo_territory_ticket_definitions.sql` 포함
- parity: definitions/items/objects/source bindings 6/6, canonical reuse 1
- rollback: `1.000000 -> 0.999999 -> 1.000000`
- replay: 신규 migration 0, parity 6/6 유지
- reconnect: 2회 모두 6/6
- Shadow: 6/6 PASS

## 다음 행동

1. 구현·증거 9개 파일을 commit/push한다.
2. WBS Gate1~7, DB 매핑, 검증 근거, REPORT를 마감한다.
3. Lease 2344를 RELEASED로 전환하고 Gate8은 FALSE로 유지한다.

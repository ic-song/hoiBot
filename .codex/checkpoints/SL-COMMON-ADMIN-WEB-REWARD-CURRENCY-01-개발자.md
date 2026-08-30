# SL-COMMON-ADMIN-WEB-REWARD-CURRENCY-01 체크포인트

- 작업 키: `SL-COMMON-ADMIN-WEB-REWARD-CURRENCY-01-개발자`
- 작업 이름: 공용 관리자 웹 재화 조정 소비자 Gate 1~7
- 작업 상태: Gate 1~7·구현 commit/push 완료, WBS/REPORT 반영 대기
- 정리 후보: 아니요
- 체크포인트 버전: 2
- 마지막 갱신: 2026-08-30 17:15 KST
- 실행 ID: `개발자-SL-COMMON-ADMIN-WEB-REWARD-CURRENCY-01-20260830162101`
- 브랜치: `codex/modernization-admin-web-reward-currency-v2400-20260830`
- 기준 커밋: `82dc041e`
- 구현 커밋: `deb24017`
- Lease: `슬라이스_선점` 2346행 ACTIVE
- Gate: G1~G7 증거와 구현 commit/push 완료, WBS/REPORT 반영 대기, G8 `FALSE`
- 운영 영향: MariaDB schema·운영 데이터·legacy Rhino·`feature/prod` 변경 없음

## 구현 범위

- 기존 회원 상세에 balance와 version을 함께 제공하는 호환 read model
- `game.currency.change` 권한별 증가·차감 폼
- reason·confirmed·CSRF·idempotency key·expectedVersion 웹 계약
- 기존 REST route와 `CurrencyService.adjust` transaction 연결
- currency ledger·command audit·internal outbox·replay·rollback 검증
- generic grant와 Iris destination 경계 보존

## 검증

- focused parity 18/18 PASS
- typecheck/build PASS
- full regression 1,168 / pass 1,161 / fail 0 / skip 7
- desktop 1440×1000: diamond 증가·point 차감 PASS
- mobile 390×844: 조정 폼·수평 overflow PASS
- console warning/error 0
- 운영 데이터 접촉 false

## 다음 행동

1. evidence checkpoint commit/push와 원격 head 검증
2. WBS608 G1~G7 TRUE, G8 FALSE·VAL·Lease·REPORT 갱신
3. CONTROL ACK 후 Lease RELEASED 확인

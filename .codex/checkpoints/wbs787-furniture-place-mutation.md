# WBS787 가구 배치 mutation parity 체크포인트

- 슬라이스: `SL-FURNITURE-PLACE-MUTATION-PARITY-01`
- 실행 ID: `가구배치DB-SL-FURNITURE-PLACE-MUTATION-PARITY-01-20260909074941`
- Lease: `슬라이스_선점` 2615행 ACTIVE
- 기준 commit: `24fac92e9b73fb112dc75177945cc33326c272ad`
- consumer: `sql-repository-818137c4fb22037a`
- 대상: `MariaCanonicalFurnitureHomeRepository.placeOwnedFurniture`
- 제외: `transitionOwnedFurniture`, 운영 3306, 운영 데이터, 외부 reply/network, `feature/prod`, Gate8

## 검증

- 편집 전 source span: `13981..18385`, 4404 bytes, SHA256 `b24303b0f0b36db045cdbc5d243eea27e6abfe098b25304ba44c126c8ac5a7d9`
- migration closure: `443 → 444 → 445`
- focused repository/evidence: 26/26 PASS
- typecheck/build: PASS
- 격리 MariaDB 3346: 6 scenarios PASS
- 성공 DML: replay insert → placement insert → history insert → owned update, 총 4
- 롤백: committed 0, rollback affected 1, exact before/after SHA 동일
- duplicate/drift/restart: DML 0
- restart: child PID 불일치 확인
- concurrency: writer 1, zero-DML replay 1
- 운영 3306 listener, 외부 network/reply: 불변/0
- `transitionOwnedFurniture` body SHA: baseline/current 동일 `557c9df78713ccb5d420a89675fc38898aa3fa9f1475aff78356dc81504b58ed`

Gate7은 사용자 지시의 batch 검증 대기입니다. Lease RELEASED, REPORT ACKED, CONTROL 및 Gate7 완료 표시는 작업반장 승인 후 처리합니다.

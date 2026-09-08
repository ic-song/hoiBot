# WBS785 펫 장비 장착 mutation parity

- 실행 ID: `펫장비장착DB-SL-PET-EQUIPMENT-ASSIGN-MUTATION-PARITY-01-20260909034828`
- consumer: `sql-repository-4f896a4a6feb5ec1`
- 대상: `MariaCanonicalPetEquipmentRepository.assign`
- 소유 Lease: `슬라이스_선점` 물리 2613행
- 2026-09-09: 입력 경계, 조건부 locator, replay-first lock, 소유·활성 fail-close, 중앙 Maria retry/reconciliation 구현.
- 2026-09-09: focused repository 8/8, Wave20 회귀 4/4, Wave21 schema/oracle 및 격리 Maria 6시나리오 PASS.
- Gate7 TRUE, WBS 100%, Lease RELEASED, REPORT ACKED, CONTROL 수정은 작업반장 독립 검토 후 처리.

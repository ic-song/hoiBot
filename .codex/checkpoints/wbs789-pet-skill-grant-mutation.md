# WBS789 펫스킬 지급 DB mutation parity

- 실행 ID: `펫스킬지급DB-SL-PET-SKILL-GRANT-MUTATION-PARITY-01-20260909083514`
- Lease: 2617 (`ACTIVE`)
- consumer: `sql-repository-31c4099080d9c9c1`
- 범위: `MariaCanonicalPetSkillRepository.grant`만 변경. `equip` 본문은 baseline과 byte-equivalent.
- 구현: exact terminal replay, 입력 저장경계, 중앙 Maria exact unique/transient 정책, fresh lock order, owner-bound update, absent-stack DML 2.
- 격리 Maria: `127.0.0.1:3348`, DB prefix `hoibot_wbs789_pet_skill_grant_2617`, migration 443→444→446→449.
- targeted scenarios: success, rollback, replay, drift, restart, same-key concurrency, different-key absent-stack concurrency.
- 검증: focused 18/18, TypeScript typecheck/build, `git diff --check` 통과.
- 실증 결과: success DML 2, rollback committed 0, replay/drift/restart DML 0, same-key writer 1, different-key 합계 8, restart child PID 상이, 운영 3306 불변.
- 현재 grant span: 10065..11386, SHA256 `466996cab1e119ab162be13812ab00f6a03af79f835eb5df855308de087f94be`.
- 금지 범위: 운영 3306, 외부 reply/network, shared ledger/schema/generator/sealer/receipts, feature/prod, Gate8.
- Gate7/Lease release/REPORT ACK/CONTROL final은 작업반장 독립 검토 후 처리.

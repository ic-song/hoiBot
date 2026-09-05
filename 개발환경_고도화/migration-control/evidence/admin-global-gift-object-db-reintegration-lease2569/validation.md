# WBS752 validation

- `npm run typecheck`: PASS.
- focused: `admin-global-gift-service.test.ts` + `object-data-model-contract.test.ts`, 27/27 PASS.
- isolated MariaDB fresh apply: migration 001~479 중 repository의 467개 migration 적용, 479 포함 PASS.
- isolated MariaDB scenario: 실제 FK/no-logical-id introspection, 권한·11채널 fail-close, concurrency/replay, restart+SHADOW, inbound channel payload conflict, outbox payload/status drift, ambiguous commit 전체 evidence reconcile, active member mapping 누락, overflow rollback 8/8 PASS.
- rollback: durable receipt 존재 시 guard PASS; source binding drift fail-close PASS; 선재 exact binding 재귀속 0 및 rollback 보존 PASS; 정리된 합성 상태 rollback PASS; 479 reapply PASS; migration runner restart checksum/re-entry 467 PASS.
- object manifest: migration 30개, 표준 table 103개 계약 PASS. 신규 4개 table은 descriptive CUID8 PK, exact CUID FK, audit4 KST CHAR(19)를 사용한다.
- item identity: 런타임은 `canonical_item_definition_imports`의 exact source tuple로 `item_id`를 해석하고 이후 비교·FK·ownership은 `item_id`만 사용한다. `ITEM-FREE-HOI-SUPPORT-02`는 migration의 legacy 경계 증거일 뿐 runtime source에는 존재하지 않음을 focused test로 고정했다.
- save 의미: active-member snapshot, 대상별 +1, typed receipt, 11개 ordered outbox, command terminal이 RFA02/RFA03 root transaction 하나에서 commit된다. active legacy 회원 중 canonical mapping이 하나라도 없으면 mutation 전에 전체 fail-close한다.
- outbox 무결성: FK처럼 보이는 논리 `outbox_message_id`는 두지 않는다. canonical operation의 `operation_key`가 applied `operations(operation_key)` UNIQUE를 동일명·동일형 실제 FK로 참조한다. replay/RFA02 ambiguous-commit 재조회는 이 operation 아래 outbox 11개를 생성 순서로 channel snapshot의 sequence/destination/payload hash와 대조하고 delivery status 허용 집합 및 terminal receipt까지 검산한다. INFORMATION_SCHEMA에서 해당 FK와 신규 schema FK 총 7개를 확인했다.
- external dependency: validator에는 applied migration 002의 `operations(id PK, operation_key UNIQUE)` 실제 최소 shape만 pin했고 신규 권위나 공용 DB/runtime 동작은 추가하지 않았다. shape drift 계약 테스트 PASS.
- legacy `main.js`, `Info.js`, `data/`는 수정하지 않았다.
- 독립 읽기전용 재리뷰: P0=0/P1=0/P2=0, APPROVED.

검증 이력 주의: 개발 중 실수로 full test 명령을 한 번 시작했으나 즉시 중단했으며 의존성 미연결 출력만 발생했다. 해당 실행은 T3 또는 성공 증거로 주장하지 않는다. 이후 허용된 focused test만 별도로 실행해 위 결과를 얻었다.

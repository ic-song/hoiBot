# WBS770 펫스킬 정보 직접응답 검증

## 범위

- 대상: `SL-PET-SKILL-INFO-DIRECT-REPLY-01`
- 명령: `/펫스킬정보`
- C16 구현·실행 증거 기준: `cf8552bb48040e79b1ab5a2b4866b80b3d49e37b`
- C17 receipt·ledger 봉인: `8960ffde40f682ca3dad06b8941ece645b2f76ce`
- 목적: 기존 SHADOW 호환성을 유지하면서 CANARY에서 읽기 전용 결과를 한 root transaction의 outbox receipt로 저장하고, 실제 외부 답장은 worker만 소유하게 한다.
- 제외: 운영 데이터 이관, 운영 DB 변경, 실운영방 응답, Gate8 운영 전환, `feature/prod` 반영

## 확정 계약

- `PET_SKILL_INFO`의 정확한 SHADOW v1 registry 행만 Migration 487에서 CANARY v2로 승격한다.
- routing `event_id`는 UTF-8 `VARCHAR(128)`까지 허용하고 129자는 영속화 전에 거부한다.
- routing hash는 레거시와 동일한 normalized effective message를 사용하여 WBS769 SHADOW row를 중복 삽입 없이 재사용한다.
- MODERN 성공은 routing/claim/operation/execution/outbox를 한 root transaction에서 정확히 한 번 기록한다.
- 동일 event replay는 evaluator와 DML을 재실행하지 않고 저장된 reply·목적지·fingerprint를 검증한다.
- MODERN 거부와 역사적 SHADOW 완료는 사용자 outbox를 만들지 않는다.
- HTTP 요청 경로는 즉시 외부 전송하지 않고 outbox worker만 실제 전송을 소유한다.
- rollback은 registry/schema/100자 초과 event drift를 먼저 차단하고 CANARY v2 및 `VARCHAR(128)`을 SHADOW v1 및 `VARCHAR(100)`으로 정확히 복원한다.
- Wave16은 Wave14의 160개 receipt를 보존하고 Wave15의 7개 SHADOW receipt를 7개 DIRECT receipt로 대체한다. Wave1~15 원본 파일은 변경하지 않는다.

## 검증 결과

- 관련 기능 집중 테스트: 58/58 PASS
- Wave15 역사적 봉인 + Wave16 실행: 6/6 PASS
- parity ledger 회귀: 4/4 PASS
- transition contract: 14/14 PASS, 독립 리뷰 GO, P0/P1/P2 0건
- TypeScript typecheck: PASS
- build: PASS
- object data model contract: 등록 대상 111개 PASS
- `git diff --check`: PASS
- Wave16 generator: 과거 Wave14 160건 보존, Wave15 7건 대체, Wave16 7건 추가, 총 167건 PASS
- ledger validator: Schema와 receipt schema 모두 `AJV2020_STRICT_PASS`
- ledger: manifest/entry 1,130/1,130, 누락·중복·미등록 ID 0/0/0
- ledger verdict: `DIRECT_PASS=31`, `STATIC_ONLY=1017`, `BLOCKED_DYNAMIC=82`, 나머지 0
- ledger entry set SHA-256: `ce96fdb3dcf0a9aa6381fc976cd0f3ebba3e92fccb13478d1cfe74257aa5b5ce`
- C16 evidence commit이 C17 HEAD의 ancestor임을 validator가 확인했다.

## 격리 MariaDB 리허설

- MariaDB 12.2, `127.0.0.1:3340`, DB `hoibot_wbs770_pet_skill_direct`
- Migration 475개 적용 및 Migration 487 1개 확인
- forward, replay, rollback, drift guard, reapply 모두 PASS
- 직접응답 1건, replay DML 0, 거부 outbox 0, 역사적 SHADOW outbox 0
- worker 전송 spy 1건, replay 추가 전송 0, 외부 네트워크 0
- 무관 registry checksum 불변
- 종료 후 3340 listener 0, 임시 DB 삭제, 운영 3306 불변

```text
WBS770_ISOLATED_MARIADB_PASS migrations=475 migration487=1 rollback487=restoredExact rollbackDriftGuard=pass migration487Reapply=pass unrelatedRegistryUnchanged=true atomicDirect=1 replayDml=0 deniedOutbox=0 historicalShadowOutbox=0 workerSpySends=1 workerReplay=0 externalNetwork=0 port=3340 database=hoibot_wbs770_pet_skill_direct tempCleaned=true production3306Unchanged=true
```

## 재현 명령

```text
node --import tsx --test test/app-wiring-read-only-recovery-provider.test.ts test/pet-skill-info-read-only-recovery-ingress.test.ts test/pet-skill-info-shadow-http.test.ts test/private-chat-denial-notification-service.test.ts test/pet-skill-info-direct-reply-migration.test.ts test/object-db-consumer-executable-parity-wave16.test.ts
node --import tsx --test test/object-db-consumer-executable-parity-wave15.test.ts test/object-db-consumer-executable-parity-wave16.test.ts
node --import tsx --test test/object-db-consumer-transition-contract.test.ts
node --import tsx scripts/validate-object-db-consumer-executable-parity-ledger.ts
npm run typecheck
npm run build
node --import tsx scripts/validate-object-data-model-contract.ts
powershell -ExecutionPolicy Bypass -File scripts/rehearse-pet-skill-info-direct-reply-wbs770.ps1
git diff --check
```

## 전체 테스트 모음 주의

- 전체 `npm test`에는 이번 변경과 무관한 기존 WBS743 실패가 남아 있으므로 전체 모음 green을 주장하지 않는다.
- WBS770 Gate 증거는 위 집중 테스트, 실행 패리티, transition contract, 격리 MariaDB, 독립 리뷰 결과로 한정한다.

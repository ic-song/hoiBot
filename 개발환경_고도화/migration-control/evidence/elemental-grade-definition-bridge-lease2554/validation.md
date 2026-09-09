# Lease2554 정령 등급 정의 bridge 검증

## 범위

- catalog: `SC-20260902-1`
- execution: `장비정의DB-SL-DATA-MIGRATION-CATALOG-PROJECTION-01-EQUIPMENT-SCHEMA-EXTENSION-202609051849`
- migration: `477_elemental_grade_definition_bridge.sql`
- dependency: migration119 legacy 61 grades, migration443 identity/audit, migration475 canonical equipment grade definitions
- 제외: `app.ts`, `spirit-info-service.ts`, Lease2553 파일, 운영 JSON/DB/방, feature/prod, Gate8

## 설계 검증

- bridge PK: `elemental_grade_definition_bridge_id CHAR(8) ascii_bin`
- canonical FK: `equipment_grade_definition_id CHAR(8) ascii_bin` → 동일 이름/shape PK, `ON DELETE RESTRICT`
- 감사 컬럼 4개와 KST `YYYY-MM-DD HH:MM:SS` CHECK
- 표시명, alias, emoji, legacy `grade_code`는 bridge identity에서 제외
- source identity: sealed Common Staging의 locator + structural pointer + target table을 SHA-256한 값
- 61개 `gradeOrder`, `sourceIdentifier`, numeric tuple hash, ordered aggregate hash, binding fingerprint, manifest hash를 전부 DML 전에 재계산
- bridge identity/crosswalk은 migration443 공용 CUID2 8자리 충돌 재시도 provider를 재사용
- rollback은 exact bridge 61행과 bridge namespace가 소유한 identity/crosswalk만 삭제; migration119/475 행은 보존

## focused 검증

실행:

```text
node --import tsx --test test/elemental-grade-definition-bridge.test.ts
```

결과: `4/4 PASS`

- migration477 additive/descriptive PK·FK/audit와 runtime/migration-control rollback byte parity
- sealed staging → name-free hash manifest 61행, contiguous order와 unique source identity
- order/scope/payload/binding/numeric-order/manifest drift fail-close
- amendment/schema plan/hash manifest 계약과 object model amendment 검증

관련 회귀:

```text
node --import tsx --test test/object-data-model-contract.test.ts test/equipment-grade-definition-extension.test.ts test/elemental-grade-definition-bridge.test.ts
```

결과: `31/31 PASS`

## MariaDB 통합 검증

격리 대상:

- container: `hoibot-modernization-mariadb-1`
- schema: `hoibot_rehearsal_elemental_bridge_2554`
- account: `lease2554_test`
- migration: `001~477`, 파일 기준 `465`개 적용
- input: migration119의 committed seed와 비식별 synthetic migration475 rows; 운영 snapshot 미사용

실행:

```text
RUN_ELEMENTAL_GRADE_BRIDGE_MARIADB_INTEGRATION=true
node --import tsx --test test/elemental-grade-definition-bridge-mariadb.integration.test.ts
```

결과: `2/2 PASS`

검증 결과:

- migration119 legacy numeric row `61`
- 동일 sealed staging에서 canonical source locator/binding `61`, unmapped `0`, duplicate `0`
- ring-family drift: pre-DML fail, bridge/crosswalk/identity `0/0/0`
- source namespace drift: pre-DML fail, bridge/crosswalk/identity `0/0/0`
- canonical numeric drift: pre-DML fail, bridge/crosswalk/identity `0/0/0`
- legacy grade order drift: pre-DML fail, bridge/crosswalk/identity `0/0/0`
- 첫 CUID 후보 충돌 후 재시도 성공
- order 2 강제 trigger 실패: transaction rollback 후 bridge/crosswalk/identity `0/0/0`
- 최초 apply: bridge/crosswalk/identity `61/61/61`
- exact replay: inserted `0`, 기존 count/receipt hash 불변
- read-only Shadow: exact `61`, DML `0`
- rollback: bridge/crosswalk/identity를 각각 `61` 삭제하여 `0/0/0`
- rollback 후 migration119/migration475 source rows: `61/61` 보존
- restart: `61` 재생성, 후속 rollback `61`, 두 번째 rollback `0`
- table empty + orphan bridge namespace crosswalk/identity `0/1/1`: static rollback 첫 scalar에서 fail-close
- table empty + orphan object type identity `0/0/1`: static rollback 첫 scalar에서 fail-close
- 두 orphan 케이스 모두 실패 전후 `SHOW CREATE TABLE` SHA-256, 관련 data SHA-256, table count `1`, migration477 기록 count `1` exact 불변; 후속 DROP/DDL/DML 흔적 `0`
- runtime/migration-control rollback mirror byte exact SHA-256: `a8aa4b958af939696cda921801fdb3f05a8a95ec53bd92d49393c28ba31f9c00`

실제 스키마 대사:

- migration477 applied row `1`
- bridge columns `12`
- canonical FK `1`
- CUID8 ascii/ascii_bin PK·FK columns `2`
- audit columns `4`
- test 종료 bridge/crosswalk/identity `0/0/0`, 강제 trigger `0`

## 정적·빌드·표준 검증

```text
npm.cmd run typecheck
npm.cmd run build
npm.cmd run object-data:validate
node --import tsx scripts/validate-object-data-model-contract.ts ../migration-control/contracts/object-data-model-elemental-grade-bridge-amendment.v1.json
```

결과:

- typecheck: PASS
- build: PASS
- canonical object validator: PASS, registered objects `98`
- bridge amendment validator: PASS, registered tables `3`
- `git diff --check`: PASS
- `main.js`, `Info.js`, DEV/PROD path, saveJsonFile/loadJsonFile 변경 없음

## cleanup

- dedicated schema drop 후 count `0`
- dedicated account drop 후 count `0`
- repository tracked input 및 운영 데이터 변경 `0`

## 제한

- 운영 JSON 원문과 운영 DB는 읽거나 쓰지 않았다.
- 실제 운영 데이터 이관, cutover, 실운영방, `feature/prod`, Gate8은 별도 승인 전 금지 상태를 유지한다.

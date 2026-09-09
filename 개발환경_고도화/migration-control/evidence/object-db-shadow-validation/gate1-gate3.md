# WBS744 오브젝트 DB Shadow 검증 Gate 1~3 근거

## 판정

- 범위: WBS744 Gate 1(현행 조사), Gate 2(비교 매핑), Gate 3(비식별 합성 fixture) 계약
- 상태: `GATE1_GATE3_CONTRACT_ONLY`
- Shadow 완료: 아니요
- Gate 4~7: 미착수
- Gate 8 운영 준비: 범위 밖

이 근거는 실제 Shadow provider, 시험 DB 실행, 소비자 통합, 운영 관찰을 완료했다는 뜻이 아니다.

## Gate 1 — 권위 근거와 도메인 확정

도메인 수를 선험적으로 정하지 않았다. `object-domain-import-field-map.v1.json`의 `mappings[].domain`을 현재 순서대로 읽어 다음 12개를 확정했다.

1. `player`
2. `item`
3. `furniture`
4. `pet-equipment`
5. `mini-pet`
6. `member-title`
7. `pet-title`
8. `mini-pet-title`
9. `pet-skill`
10. `currency`
11. `package`
12. `building-recipe`

같은 field map의 `targetTables` 합집합은 중복 없이 45개다. 계약 테스트는 이 두 수치를 다시 계산하므로 수동 목록이나 표준 문서의 종류 나열만으로 범위를 늘리지 않는다.

권위 근거:

- `docs/database/OBJECT_DATA_MODEL_STANDARD.md`
- `migration-control/contracts/object-data-model-standard.v1.json`
- `migration-control/contracts/object-domain-import-field-map.v1.json`
- `migration-control/contracts/object-domain-import-target-schema.v1.json`
- `migration-control/contracts/object-domain-import-identity-bindings.v1.json`
- `migration-control/contracts/data-migration-object-domain-import.v1.json`
- `migration-control/contracts/object-db-consumer-transition.v1.json`
- `migration-control/contracts/object-db-consumer-additive-schema-plan.v1.json`

WBS 근거는 WBS731 identity/audit, WBS733~741 도메인 schema, WBS742 import projection, WBS743 consumer transition으로 연결했다. 저장소에서 명시 근거를 찾지 못한 WBS 번호를 개별 도메인 소유자로 만들지 않았다.

## Gate 2 — 비교 계약

`object-db-shadow-validation.v1.json`은 각 도메인마다 다음을 고정한다.

- WBS742 레거시 source 목록과 field-map projection 의미
- canonical 직접 대상 테이블
- target-schema가 각 테이블 컬럼에 선언한 실제 migration 소유권
- persisted identity/crosswalk 선행조건
- 도메인별 비교 identity key와 canonical row-set oracle
- mismatch taxonomy와 promotion 차단 규칙
- read-only, no-lock, no-write 실행 규칙
- exact Unicode byte 보존과 tagged decimal BIGINT canonicalization
- restart 반복성과 zero-mutation 증명 요건

Identity는 `443_object_identity_audit_provider.sql`과 `461_object_db_transition_identity_crosswalk.sql`의 persisted crosswalk를 선행조건으로 한다. legacy BIGINT를 canonical `CHAR(8)`로 cast하거나 표시명·닉네임·배열 근접성으로 추론하지 않는다.

Gate 1~3 quarantine은 메모리 내 합성 결과만 허용한다. 기존 import quarantine, audit, receipt, outbox, JSON 또는 DB에 쓰지 않는다.

## Gate 3 — 비식별 합성 fixture

`object-db-shadow-validation-v1.json`은 12개 파생 도메인을 각각 한 번 포함한다. 모든 식별자는 합성 8자리 값 또는 반복 hex locator이며 운영 스냅샷, 실제 사용자 키, 이메일, 방 정보와 토큰을 포함하지 않는다.

각 도메인은 flat 요약 객체가 아니라 `rowsByTable`을 가지며, WBS742의 45개 직접 대상 테이블 모두에 대해 typed row envelope를 제공한다. 각 envelope는 실제 PK 값(`pk`), 선언된 FK closure(`refs`), 레거시 projection(`legacy`), canonical projection(`canonical`)을 분리한다. 감사 컬럼을 포함한 모든 `NOT NULL` 값을 가짜로 채우지 않고 Gate 3 oracle에 필요한 선택 컬럼만 사용하며, 테스트가 선택 컬럼의 target-schema 존재 여부와 실제 SQL type을 대조한다.

fixture는 다음 경계를 포함한다.

- object key 삽입 순서와 무관한 canonical JSON
- 한글·이모지·variation selector exact 보존
- NFC가 같은 composed/decomposed 문자열도 byte mismatch로 분류
- JavaScript safe integer를 넘는 BIGINT tagged decimal 보존
- 잘못된 leading-zero BIGINT 거부
- restart 재실행 digest 동일성
- synthetic mismatch를 durable quarantine에 쓰지 않고 분류만 수행
- 실제 manifest PK 기반 stable row ordering과 선언된 FK target/value closure

Mismatch taxonomy 13개는 category/scope/stage 조합이 유일하다. 현재 Gate 3 classifier 실행 증거가 있는 범위는 `IDENTITY_UNRESOLVED`, `FIELD_VALUE_MISMATCH`, `UNICODE_BYTE_MISMATCH`, `BIGINT_ENCODING_INVALID` 4개뿐이다. 나머지 9개는 `GATE4_REQUIRED` 예약이며 현재 분류 완료로 간주하지 않는다. 4개 지원 category 각각에 대해 계약의 quarantine record field 전체를 가진 비식별 expected envelope를 검증한다.

테스트는 fixture 도메인 순서와 유일성을 field-map과 exact 비교하고, 각 `rowsByTable` key 목록이 해당 domain의 `targetTables`와 순서까지 같으며 모든 table에 최소 한 행이 있음을 확인한다. Restart digest는 field-map 도메인 순서, Unicode scalar 테이블명 순서, 실제 PK 행 순서로 정규화한다. 도메인 배열과 `rowsByTable` key 삽입 순서를 역전한 동등 fixture도 같은 digest를 내야 한다.

## Zero mutation 범위

이번 테스트는 계약, fixture, 권위 계약, 참조 migration의 실행 전후 SHA-256과 byte length가 같음을 확인하고 write/lock SQL 금지 목록을 검증한다. 운영 `data/*`, `/sdcard/호이랜드/`, `/sdcard/호이랜드_dev/`, 운영 DB, 실운영방과 `feature/prod`는 읽거나 쓰지 않았다.

실제 DB session의 read-only principal, schema checksum, table row-count/checksum, outbox/receipt/audit/import-ledger/quarantine before/after 증명은 Gate 5 요구사항이며 이번 근거로 완료 처리하지 않는다.

## 검증

실행 위치: `개발환경_고도화/runtime`

```powershell
node -e "const fs=require('fs'); for (const p of process.argv.slice(1)) JSON.parse(fs.readFileSync(p,'utf8')); console.log('JSON_PARSE_PASS', process.argv.length-1)" '../migration-control/contracts/object-db-shadow-validation.v1.json' '../migration-control/fixtures/synthetic-relational/object-db-shadow-validation-v1.json'
node --import tsx --test test/object-db-shadow-validation-contract.test.ts
npm.cmd run typecheck
```

결과:

- JSON parse: `JSON_PARSE_PASS 2`
- focused test: `8 PASS / 0 FAIL` (45-table rowsByTable, 실제 column/type/PK/FK closure, 독립 WBS lineage와 taxonomy 기대값 포함)
- TypeScript: `tsc -p tsconfig.json --noEmit` PASS

신규 4개 파일은 index를 변경하지 않는 `git -c core.autocrlf=false -c core.safecrlf=false diff --no-index --check -- NUL <file>` 방식으로 각각 검사해 `DIFF_CHECK_PASS 4`를 확인했다. 기본 Windows Git 설정의 첫 실행은 내용 오류가 아니라 “LF will be replaced by CRLF” 경고만 출력했으며, 변환 설정을 끈 검사에서는 whitespace 오류가 없었다.

## 남은 Gate 4~7

- Gate 4: WBS742 projection을 복제하지 않는 shared read-only Shadow adapter/provider와 deterministic mismatch emitter 구현
- Gate 4: 현재 keyword denylist를 실행 경계로 오해하지 않고, 주석·CTE 내부 write·multi-statement·stored routine·locking modifier·dialect 우회를 막는 parsed-statement 및 read-only connection capability 강제 구현
- Gate 5: 신규 격리 synthetic MariaDB, read-only principal, 정상·경계·실패·중복·restart 실행 및 DB zero-mutation 증명
- Gate 6: 완료된 WBS743 consumer family별 통합, 출력·순서·Unicode·BIGINT·reference closure parity
- Gate 7: 승인된 Shadow 관찰 구간, 전 도메인/consumer coverage, quarantine 0, restart digest 안정성, mutation 0, commit/push 및 작업반장 ACK

Gate 8의 운영 snapshot 대사, backup/restore, cutover, rollback, 운영 smoke와 승인도 별도 남아 있다.

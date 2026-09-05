# ITEM 25 canonical definition 결속 provider 검증

- 범위: WBS747 / Lease2556 / `SC-20260902-1`
- 기준 commit: `f07021701d2f058531512b0e805dc0d9c4b2a3fb`
- 성격: 비운영 provider 개발·격리 검증이며 운영 이관, app consumer 전환 및 Gate8 근거가 아니다.
- schema 변경: `0` (migration, DDL, typed extension 추가 없음)
- 운영 유사 JSON: 저장소에 추적된 `data/itemInfo.json` snapshot을 read-only 입력으로 읽음; 원문 수정·복사·재저장 `0`
- 운영 DB·실운영방·외부 reply/network·`feature/prod` 변경: `0`

## 재사용 경계

- 정의: `canonical_item_definitions`와 `definition_options`
- provider 소유 binding/receipt: `canonical_item_definition_imports`
- 기존 CUID identity: `object_identities`, `object_identity_crosswalks`
- 기존 source lineage: Common Staging → Catalog Projection → Object Domain Import receipt
- 사용자 수량형 보유: `CanonicalItemInventoryRepository` → `canonical_owned_item_stacks(player_id,item_id,quantity)`
- 이름과 legacy `CODE`는 identity나 비교 키로 사용하지 않는다.

## exact 계약

- 봉인된 `data/itemInfo.json` source path/content hash와 authoritative item25 manifest hash를 고정하고, 임의 입력의 자가 hash는 허용하지 않는다.
- RAID 9, territory 6, castle 10의 exact pointer·locator·payload allowlist와 선행 3개 catalog scope 승인 hash를 전수 대사한다.
- exact RFC 6901 source pointer, source locator, source payload fingerprint와 normalized `definition_options` fingerprint를 manifest에 봉인한다.
- `25 = RAID_SPECIAL 9 + TERRITORY_TICKET 6 + CASTLE_UNIT 10`
- source pointer → `object-import.item.canonical_item_definitions` crosswalk → 기존 CHAR(8) `item_id` → domain import receipt를 전수 대사한다.
- 실제 사용하는 12개 테이블의 모든 참조 컬럼, PK/FK/UNIQUE/type/collation을 information_schema와 authoritative contract에 결속한다.
- Common Staging/Projection/Object Domain Import의 COMPLETE run envelope·hash·count·status, 전체 projection/decision fingerprint, import fingerprint와 decision receipt 25개 및 실제 canonical definition 값이 모두 일치한 뒤에만 DML을 시작한다.
- 하나라도 누락·중복·partial·ambiguous·drift·conflict이면 provider-owned DML 전에 fail-close 한다.

## 멱등성·원자성·복구

- 최초 적용: exact import binding `25`, canonical definition/identity/crosswalk 신규 생성 `0`
- 동일 manifest 재실행: binding DML `0`, 같은 `item_id` 25개 재생
- 업무 UNIQUE 동시 경합: 실제 독립 connection pool 2개로 동시에 적용하여 단일 writer 25건과 경쟁 writer replay DML 0을 확인했다. MariaDB `ER_CHECKREAD`/deadlock/lock timeout은 bounded retry 후 exact state를 재검증한다.
- 강제 두 번째 INSERT PK 충돌 소진: 첫 INSERT까지 포함한 transaction 전체 rollback, 잔여 binding `0`
- Shadow: repeatable-read read-only snapshot capability만 사용, exact binding `25`, DML `0`
- rollback: provider-owned `LEGACY_JSON/itemInfo.json/<exact pointer>` import binding 25개만 제거
- rollback 보존: canonical definition 25, identity crosswalk 25, Object Domain receipt 25, 사용자 owned stack 1 모두 동일
- restart: rollback 후 재적용 25, 재-rollback 25, 빈 상태 rollback 0

## 검증 결과

- focused provider unit: `6/6 PASS`
- 관련 Common Staging + Catalog Projection + Domain parity + canonical item inventory + provider: `26/26 PASS`
- TypeScript typecheck: `PASS`
- build: `PASS`
- object-data validator: `98개 등록 대상 PASS`
- 격리 MariaDB migration: `001~477`, 적용 migration `465`
- 실제 Maria provider integration: `1/1 PASS`
- 실제 Maria 동시성: 독립 connection pool `2`, 결과 `25 insert + replay DML 0`
- 격리 실행 종료 직전 provider 및 연관 fixture 16개 테이블 count = 모두 `0`
- listener, 임시 경로, task 환경변수 복원 = 모두 cleanup 확인
- 기계 판독 transcript: rehearsal script가 `mariadb-transcript.json`을 직접 생성·재검증하며 명령/exit/output hash/timestamp, migration/source aggregate, artifact hash, cleanup0, secret scan0과 tamper negative 결과를 보존
- 전체 `npm test`: 리소스 정책과 Lease 범위에 따라 실행하지 않음

## 재현 명령

사전 조건은 PowerShell Core 7 이상이며 repository root로 이동한 뒤 아래 명령을 그대로 실행한다. 실제 작업 PC의 절대경로는 증빙에 저장하지 않는다.

```powershell
cd <repository-root>
pwsh -NoProfile -File "./개발환경_고도화/migration-control/evidence/item25-canonical-definition-provider-lease2556/rehearse-item25-provider.ps1"
pwsh -NoProfile -File "./개발환경_고도화/migration-control/evidence/item25-canonical-definition-provider-lease2556/rehearse-item25-provider.ps1" -ValidateTranscriptOnly
```

## 범위 밖 결정

- RAID orphan 8건과 territory 6건의 app 의미 결정은 변경하지 않았다.
- app command consumer와 `/정령정보` dispatch는 변경하지 않았다.
- 운영 데이터 이관, 실제 운영 snapshot 적재, cutover, 운영 DB, 실운영방 및 Gate8은 수행하지 않았다.

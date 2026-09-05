# Lease2551 장비 등급 정의 확장 검증

## 범위와 안전 경계

- 카탈로그: `SC-20260902-1`
- migration: `475_equipment_grade_definition_extension.sql`
- 원본은 승인된 metadata-only audit에서만 읽었다.
- 원본 파일을 복사, staging, DB import, fixture 또는 commit payload로 만들지 않았다.
- 정의명, 별칭 문자열, 원본 배열 및 원본 행은 이 근거에 기록하지 않았다.
- pre/post: 31,289 bytes, SHA-256 `49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc`, unchanged.
- adapter 입력은 검증된 `CommonStagingRecord` DTO의 pointer/locator/payload/fingerprint/domain/kind/status 경계만 받는다.
- `payloadJson`은 Common Staging과 동일한 lossless canonical JSON 알고리즘으로 재계산하며 fingerprint 불일치는 projection 전에 차단한다.
- upstream envelope의 `expectedFileCount`, `expectedTotalBytes`, `projectedFileCount`, `ignoredFileCount`는 호출자 입력을 그대로 검증·투영하며 하드코딩하지 않는다.

## 구조 대사

| category | grade definitions | ordered alias leaves |
|---|---:|---:|
| elemental | 61 | 79 |
| ring | 45 | 45 |
| 합계 | 106 | 124 |

- 모든 정의의 primitive key set은 동일한 13개다.
- key presence: 각 key 106/106.
- unmapped: 0, extra: 0, duplicate mapping: 0, incomplete: 0.
- `nameList`는 정의 identity가 아닌 ordered alias/reference다.
- `emoji`는 `equipment_grade_emoji` catalog attribute이며 identity/CODE가 아니다.
- `equipment_family`, `equipment_grade_name`도 catalog attribute이며 identity/CODE가 아니다.
- 정의 identity는 exact RFC 6901 structural grade pointer로 예약하는 descriptive CUID2 `equipment_grade_definition_id`다.

| source key | JSON type | presence | target |
|---|---|---:|---|
| nameList | array(string) | 106 | alias name/order/FK rows |
| emoji | string | 106 | equipment_grade_emoji |
| upgrade | number | 106 | enhancement_success_probability |
| drop | number | 106 | enhancement_drop_probability |
| itemCost | number | 106 | item_cost_quantity |
| pointCost | number | 106 | point_cost_amount |
| maxLevel | number | 106 | maximum_enhancement_level |
| battleExp | number | 106 | battle_base_experience_amount |
| battleUpgradeExp | number | 106 | battle_experience_per_enhancement_amount |
| raidExp | number | 106 | raid_base_experience_amount |
| raidUpgradeExp | number | 106 | raid_experience_per_enhancement_amount |
| castleExp | number | 106 | castle_base_experience_amount |
| castleUpgradeExp | number | 106 | castle_experience_per_enhancement_amount |

## 비노출 타입·범위 통계

- 숫자 1,166개는 모두 finite다. unsafe integer 0, exponent notation 0이다.
- 확률 원본 단위는 fraction이며 변환하지 않는다. `upgrade` min/max 0.2/1, `drop` min/max 0/0, 최대 소수 자릿수 2/0이다.
- 정수형 key는 모두 소수 자릿수 0이며 관측 최대 정수 자릿수는 9다.
- base/per-enhancement 값은 battle, raid, castle별 6개 컬럼으로 분리하며 합치지 않는다.
- emoji 106개: UTF-8 3..13 bytes, UTF-16 1..5 units, Unicode code point 1..4, empty/leading/trailing/embedded whitespace 0, invalid surrogate 0.
- emoji DB 상한은 관측 최대 4 code points보다 여유 있는 `VARCHAR(32)`와 `CHAR_LENGTH BETWEEN 1 AND 32`로 설정하며 절단하지 않는다.
- 정수 값은 unsafe integer까지 exact 보존할 수 있는 `DECIMAL(65,0)`, 확률은 `DECIMAL(31,30)`을 사용한다.

## 집중 검증

- 신규 focused unit/contract: 4/4 PASS.
- actual Maria catalog→object importer integration: 1/1 PASS.
- 신규 및 기존 catalog projection/object importer/profile/field-map/target-schema focused: 58/58 PASS.
- TypeScript typecheck: PASS.
- TypeScript build: PASS.
- additive object-data-model validator: PASS, tables 2.
- `git diff --check`: PASS.

## isolated MariaDB

- 임시 DB allowlist: `hoibot_eq475_2551`; 검증 후 DB와 container 임시 SQL을 삭제했고 schema existence count 0을 확인했다.
- forward: grade/alias tables 2 생성.
- synthetic aggregate: definitions 106, aliases 124, elemental 61/79, ring 45/45.
- FK exact name/type: 1/1; audit columns: 8/8; mode-specific EXP columns: 6/6.
- decimal readback: scale-30 probability 및 battle/raid/castle per-enhancement 값이 각각 분리되어 exact readback.
- same synthetic 230-row replay: cumulative `ROW_COUNT()` 0, aggregate unchanged 106/124.
- rollback guard: alias가 있는 definition 삭제는 FK RESTRICT error 1451로 거부되고 aggregate가 보존됐다.
- destructive rollback guard: rows가 남은 상태에서는 preflight가 rollback을 거부하도록 고정했다.
- clean reverse rollback: 명시적으로 synthetic rows를 정리한 뒤 alias table 다음 definition table 삭제, 대상 table 0; 별도 sentinel row 1 보존.
- restart: rollback 뒤 forward 재적용으로 대상 tables 2, empty aggregate 0/0, sentinel row 1을 확인했다.
- actual Common Staging run: 106 records, exact upstream envelope `1 / 31289 / 1 / 0`.
- actual `MariaCatalogProjectionRepository.project`: decisions 106, projection records 230.
- 숫자 source key 11개는 각각 하나의 descriptive target column에 `EXPLICIT_RULE`로 고정되며, 전체 canonical payload fingerprint가 일치한 뒤에만 named source key에서 읽는다.
- actual `MariaObjectDomainImporter.importProjection`: definition 106 + alias 124 = canonical rows 230, extension namespace CUID2 crosswalk 230.
- transaction rollback: definition phase 뒤 alias trigger가 강제 실패했을 때 outer transaction 전체가 rollback되어 definition/alias 0/0.
- actual importer replay: same identity replay insertedCanonicalRows 0.
- staging source fingerprint drift와 import receipt fingerprint drift는 fail-closed이며 canonical aggregate를 변경하지 않았다.
- importer rollback 뒤 definition/alias 0/0, 동일 catalog projection restart import 230, final rollback을 확인했다.

운영 데이터 이관, 운영 DB, final migration, feature/prod, Gate 8 및 실방 검증은 수행하지 않았다.

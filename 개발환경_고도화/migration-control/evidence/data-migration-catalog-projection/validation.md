# WBS725 Catalog Projection Gate 1~4 검증

- 슬라이스: `SL-DATA-MIGRATION-CATALOG-PROJECTION-01`
- 실행 ID: `카탈로그투영DB-SL-DATA-MIGRATION-CATALOG-PROJECTION-01-202609031600`
- 카탈로그: `SC-20260902-1`
- Lease: `2531`
- 입력 provider: `457_data_migration_common_staging.sql`
- 구현 migration: `458_data_migration_catalog_projection.sql`
- 운영 영향: 없음

## Gate 1 현행 조사

- WBS724의 COMPLETE run, stable logical source, exact RFC 6901 pointer, owner/source/quantity/time envelope, locator/fingerprint를 변경 없이 입력 경계로 사용한다.
- WBS742의 frozen disposition/field-map/identity binding/target schema를 기준으로 모든 Common Staging record를 정확히 한 번 `PROJECT`, `QUARANTINE`, `IGNORE`로 판정한다.
- 기존 generator는 source discovery/hash/duplicate detection 용도로만 참조하며 CODE, object_key, BIGINT identity 출력은 사용하지 않는다.
- WBS722/723 공개 quarantine 근거와 동일하게 원문 식별자는 evidence에 남기지 않고 hash·사유만 보존한다.

## Gate 2 DB 매핑

| 대상 | 역할 | 핵심 계약 |
| --- | --- | --- |
| `data_migration_catalog_projection_runs` | 투영 실행 | CUID2 8자리 PK, Common Staging COMPLETE FK, manifest/schema/projection hash, PROJECT/QUARANTINE/IGNORE 및 row count, 감사 4컬럼 |
| `data_migration_catalog_source_decisions` | source 전수 판정 | CUID2 8자리 PK, run/record 이름·타입 일치 FK, locator/payload fingerprint, 판정·사유·row count, 감사 4컬럼 |
| `data_migration_catalog_projection_records` | typed target 투영 | CUID2 8자리 PK, run/decision 복합 소유 경계, stable identity locator, source role, typed payload/value origin/FK binding fingerprint, 승인 provenance, 감사 4컬럼 |

- target PK는 구체적 CUID2 8자리 또는 WBS742가 명시한 재사용 PK만 허용한다.
- payload는 target schema의 비 PK·비 FK·비 감사 컬럼을 정확히 한 번 포함하고, FK는 이름·타입이 일치하는 reference binding으로 분리한다. SOURCE_EXACT/SOURCE_ABSENT는 RFC 6901 source binding으로 잠긴 Common Staging payload_json과 직접 대사한다.
- bare `id`, CODE, business version, executable payload를 거부한다.
- 동일 manifest는 COMPLETE run parity를 검증해 쓰기 0건으로 재생하며, preflight부터 COMPLETE 전환까지 하나의 transaction이다.

## Gate 3 합성데이터와 도메인 대사

- fixture: `migration-control/fixtures/synthetic-relational/data-migration-catalog-projection-v1.json`
- exact 아이템명 `다이아상자💎(/다이아상자오픈)`을 변경 없이 보존한다.
- 가구 가격/강화당 매력은 `APPROVED_CATALOG`만 허용하며 unresolved/ambiguous 정의는 source quarantine 사유를 그대로 전파한다.
- 미니펫 occurrence는 `OCCURRENCE_CROSSWALK` 승인과 `mini_pet_id` crosswalk binding을 요구한다. sourceRole은 잠긴 Common Staging `record_kind`와 같아야 하며, `MINI_PET_BAG`은 미장착·미귀속, `MINI_PET_EQUIPPED`는 장착·귀속 상태만 허용하고 누락 강화값 계약 기본값은 `0`만 허용한다.
- 미니펫 정의의 판매가/최대강화/활성 및 강화 규칙의 증가치/확률/비용은 승인 카탈로그 출처만 허용한다.
- member/pet/mini-pet 3종 title 정의 가격은 승인 카탈로그 출처만, 보유 title 취득가는 원문 exact 또는 absent만 허용한다.
- 장비 내구도는 원문 exact 또는 명시 규칙만 허용한다.

## Gate 4 구현

- `catalog-projection-provider.ts`: manifest/schema/domain 검증, deterministic plan, atomic MariaDB repository, exact replay parity
- `import-catalog-projection.ts`: manifest 기반 격리 DB 적재와 명시 rollback CLI
- `data-migration-catalog-projection.test.ts`: schema/도메인/fixture/replay/quarantine 회귀
- `data-migration-catalog-projection-mariadb.integration.test.ts`: `RUN_MARIADB_INTEGRATION=true`에서 실제 migration replay/rollback 검증

## 검증 결과

- focused+WBS724+WBS742 회귀: `56 PASS / 0 FAIL`
- MariaDB integration: 환경 변수 비활성으로 2개 suite skip; 실제 격리 DB 증거는 Gate 5에서 수행
- TypeScript typecheck: PASS
- build: PASS
- object-data model validator: 등록 대상 `70개` PASS
- `git diff --check`: PASS
- 독립 reviewer: P1/P2 없음, Gate 1~4 승인; 동일 56/56·validator 70·typecheck/build/diff-check 재현

## 남은 Gate

- Gate 5: fresh non-operational MariaDB에서 migration 458, 실제 SQL replay/rollback/restart 통합
- Gate 6: downstream importer가 decision/record count와 fingerprint parity를 소비하는 계약 확인
- Gate 7: 격리 Shadow와 작업반장 승인
- Gate 8: 금지·미수행

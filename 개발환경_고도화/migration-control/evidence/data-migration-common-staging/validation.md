# WBS724 Common Staging Gate 1~4 검증

- 슬라이스: `SL-DATA-MIGRATION-COMMON-STAGING-EXTRACTION-01`
- 실행 ID: `공통스테이징DB-SL-DATA-MIGRATION-COMMON-STAGING-EXTRACTION-01-202609031524`
- 카탈로그: `SC-20260902-1`
- Lease: `2530`
- 입력 provider: `442_data_migration_raw_landing.sql`
- 구현 migration: `457_data_migration_common_staging.sql`
- 운영 영향: 없음

## Gate 1 현행 조사

- WBS690 RAW Landing은 byte-exact payload, source path/content SHA-256, COMPLETE run, replay/rollback 계약을 이미 제공하므로 수정하거나 복제하지 않는다.
- WBS723의 공개 quarantine 근거는 원문 식별자를 commit하지 않고 identity hash와 집계만 공개한다. Common Staging도 owner/source locator를 SHA-256으로 봉인하고 이 evidence에는 원문을 남기지 않는다.
- WBS742는 논리 manifest를 통해 RAW `source_path_sha256`을 파일 의미와 연결하고, owner/source/quantity/timestamp envelope를 입력으로 요구한다.
- RAW expected file count와 manifest entry count를 일치시키고 각 파일을 정확히 한 번 `PROJECT` 또는 사유 있는 `IGNORE`로 판정한다.
- 운영 `data/*`, 운영 DB, `feature/prod`, Gate 8은 읽거나 변경하지 않았다.

## Gate 2 DB 매핑

| 대상 | 역할 | 핵심 계약 |
| --- | --- | --- |
| `data_migration_common_staging_runs` | extraction 실행 | CUID2 8자리 `common_staging_run_id`, RAW bundle+manifest UNIQUE, 파일·byte·PROJECT/IGNORE·record count, staging SHA, 완료 상태, 감사 4컬럼 |
| `data_migration_common_staging_records` | 공통 envelope | CUID2 8자리 `common_staging_record_id`, 이름·타입 일치 FK, exact source pointer/content hash, source/owner locator hash, occurrence/domain/disposition, lossless integer quantity, KST 관측시각, JSON payload fingerprint, 감사 4컬럼 |

- RAW 442의 기존 bare `id`를 신규 schema로 복제하거나 FK로 확산하지 않는다. Common Staging은 immutable `raw_bundle_sha256`와 `source_path_sha256`으로 입력을 검증한다.
- source locator는 WBS742 동결식 `logical source name + NUL + owner hash로 치환한 identity pointer + NUL + record kind + NUL + occurrence index/projection locator`의 SHA-256이다. extractor는 `ownerPointer`가 owner token에서 정확히 끝나고 source pointer와 그 지점까지 token 단위로 같은지 검증한 뒤 `ownerPathSegmentIndex`의 exact owner-key token을 직접 SHA-256으로 치환한다. manifest가 별도 identity pointer를 주입할 수 없다. private exact pointer와 privacy-safe identity pointer를 함께 보존해 WBS725가 재현·검증할 수 있다.
- 동일 RAW bundle+동일 extraction manifest는 기존 COMPLETE run을 검증해 쓰기 0건으로 재생한다.
- 전체 manifest preflight, insert, DB parity와 COMPLETE 변경은 하나의 transaction이다.

## Gate 3 합성데이터

- fixture: `migration-control/fixtures/synthetic-relational/data-migration-common-staging-v1.json`
- exact 표시 키 `다이아상자💎(/다이아상자오픈)`은 JSON Pointer에서 `/`를 `~1`로 escape하여 원문을 보존한다.
- 비식별 owner, 수량 문자열, KST 관측시각만 사용한다.
- payload hash drift, 음수 수량, duplicate locator를 fail-closed 검증한다.

## Gate 4 구현

- `common-staging-extractor.ts`: RFC 6901 Pointer 추출, lossless JSON 숫자, stable fingerprint, owner/source hash, atomic MariaDB repository
- `import-common-staging.ts`: manifest 기반 격리 DB 적재와 명시 rollback CLI
- `data-migration-common-staging.test.ts`: schema/DB allowlist/fixture/extraction/full-envelope replay 5개 focused test
- `data-migration-common-staging-mariadb.integration.test.ts`: `RUN_MARIADB_INTEGRATION=true`에서 실제 migration 적용 DB의 replay/rollback 검증

## 검증 결과

- focused+표준/WBS742 identity·domain 경계 회귀: `38 PASS / 0 FAIL`
- 재현 명령: `node --import tsx --test test/data-migration-common-staging.test.ts test/data-migration-common-staging-mariadb.integration.test.ts test/object-data-model-contract.test.ts test/object-domain-import-disposition.test.ts test/object-domain-import-target-schema.test.ts test/object-import-crosswalk-binding.test.ts`
- MariaDB integration: 환경 변수 비활성으로 suite skip; 실제 격리 DB 증거는 Gate 5에서 수행
- TypeScript typecheck: PASS
- build: PASS
- object-data model validator: canonical 65개와 Common Staging 2개를 합친 등록 대상 `67개` PASS
- `git diff --check`: PASS
- 독립 reviewer: P1/P2 없음, Gate 1~4 승인; 동일 38/38·validator 67·typecheck/build/diff-check 재현

## 남은 Gate

- Gate 5: fresh non-operational MariaDB에서 migration 457, 실제 SQL replay/rollback/restart 통합
- Gate 6: WBS725 Catalog Projection 소비자가 동일 envelope로 source count/hash parity 확인
- Gate 7: 격리 Shadow와 작업반장 승인
- Gate 8: 금지·미수행

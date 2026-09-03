# WBS725 Catalog Projection Gate 1~5 검증

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
- target schema integrity는 raw file bytes가 아니라 object key를 재귀 정렬하고 array 순서를 보존한 canonical semantic JSON SHA-256으로 검증하여 LF/CRLF 체크아웃에 독립적이다. malformed JSON과 semantic drift는 쓰기 전에 거부한다.
- migration 458의 기존 raw schema hash run은 현재 parsed schema를 표준 two-space pretty JSON으로 재직렬화한 LF/CRLF 두 후보에서만 동적 alias를 계산한다. literal checkout hash는 사용하지 않으며, alias가 둘 이상 DB에 존재하면 모호성으로 거부하고 하나만 존재할 때 full stored parity 뒤 0-write replay한다. 신규 run은 canonical semantic hash만 저장한다.

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

- focused+WBS724+WBS742 회귀와 실제 MariaDB integration: `59 PASS / 0 FAIL / 0 SKIP`
- MariaDB integration: 작업트리 내부 fresh datadir, `127.0.0.1:3319`, allowlist DB `hoibot_rehearsal_wbs725_gate5`에서 2개 suite PASS
- TypeScript typecheck: PASS
- build: PASS
- object-data model validator: 등록 대상 `70개` PASS
- `git diff --check`: PASS
- 독립 reviewer: P1/P2 없음, Gate 1~5 승인; Maria 포함 59/59·validator 70·typecheck/build/diff-check 및 cleanup 재현·검토
- old458 manifest-hash 호환 correction: WBS724 owner 독립 재검토 P1/P2 0, focused 33/33·typecheck·validator70·diff-check 재현
- target-schema portability correction: canonical/legacy alias focused `12/12 PASS`, WBS724 포함 focused `17/17 PASS`, 전체 저장소 `1764 PASS / 0 FAIL / 8 SKIP`, typecheck/build/validator70/diff-check PASS. SKIP 8건은 별도 환경변수·MariaDB가 필요한 기존 integration이며 이번 focused 검증과 Gate5 Maria 증거 범위는 skip 없이 별도로 완료했다.

## Gate 5 격리 MariaDB 검증

- MariaDB 12.2.2, 작업트리 `.tmp/wbs725-gate5-mariadb`, loopback port `3319`, allowlist DB `hoibot_rehearsal_wbs725_gate5`의 fresh datadir에서 기존 458 checksum을 보존한 전체 migration `447개`와 additive correction migration 459 등록을 확인했다.
- 최초 projection은 run `t008ddfy`, decision `3`, record `1`을 적재했다. 실제 process를 PID `20172`에서 종료하고 PID `17520`으로 재기동해 listener 소유권을 확인한 뒤 같은 manifest가 `0/0`, `replayed=true`, 동일 run을 반환했다.
- Common Staging `expected_total_bytes`를 1→2로 변조한 replay는 `CATALOG_PROJECTION_STAGING_ENVELOPE_MISMATCH`, 종료 1이었고 실패 전후 projection count는 `1/3/1`로 같았다. 시험값만 복원했다.
- 논리 rollback은 projection `0/0/0`, upstream staging run `1`을 보존했다. migration 459 rollback은 신규 envelope column/registry `0`, 재실행은 migration 459만 적용해 총 `447`개를 복원했다.
- 기존 projection run `hnkkl6c4`를 보존한 채 459만 rollback해 old458 형태로 만든 뒤 459를 재적용했다. canonical backfill hash `b9fd391a6569112fb04f219c9edc3a2b7e0c0b2e6b899270c9d943300ded00f2`가 provider와 일치했고 같은 manifest는 동일 run, decision/record 쓰기 `0/0`, `replayed=true`를 반환했다.
- 별도 detached worktree의 실제 commit `8e4c7a4f` 코드와 migration 458로 run `zzinrqg7`을 먼저 생성했다. old projection manifest hash `84c4f86cef099e54c21844e98bc85e639e534d0468af59cb75c3cad6f6cc0762`를 유지한 DB에 현 migration runner로 459를 적용했으며 458 checksum 검증도 통과했다. 현 provider는 같은 입력을 동일 run, 쓰기 `0/0`, `replayed=true`로 재생했고 별도 upstream envelope hash `b9fd391a6569112fb04f219c9edc3a2b7e0c0b2e6b899270c9d943300ded00f2`를 검증했다. 임시 detached worktree와 datadir은 listener 종료 후 제거했다.
- `RUN_MARIADB_INTEGRATION=true` 관련 회귀는 `59/59 PASS`, 실제 MariaDB suite 2개도 skip 없이 통과했다.
- 운영 3306 서비스와 DB, 운영 JSON, Docker, `feature/prod`, Sheet, Gate 8은 변경하지 않았다. 종료 시 captured restart PID와 port listener를 대사하고 작업트리 내부 exact 임시 경로만 삭제한다.

## 남은 Gate

- Gate 6: downstream importer가 decision/record count와 fingerprint parity를 소비하는 계약 확인
- Gate 7: 격리 Shadow와 작업반장 승인
- Gate 8: 금지·미수행

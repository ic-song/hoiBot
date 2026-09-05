# RAW Landing 표준 보정 검증 — Lease2552

- 기준 commit: `74ed0a4990ec121aca60568d116dd9385b731537`
- branch: `codex/raw-landing-standard-correction-v1-20260905`
- 신규 migration: `476_data_migration_raw_landing_standard_correction.sql`
- 기존 migration442: 변경 없음(`git diff --exit-code -- .../442_data_migration_raw_landing.sql` 통과)
- 범위: 비운영 합성 데이터와 전용 MariaDB 스키마만 사용

## 구현 계약

- `data_migration_raw_runs.raw_landing_run_id`: `CHAR(8) ascii_bin` PK
- `data_migration_raw_files.raw_landing_file_id`: `CHAR(8) ascii_bin` PK
- `data_migration_raw_files.raw_landing_run_id`: 이름·타입·길이·문자셋·collation이 참조 PK와 같은 FK
- 신규 행: 공용 CUID2 길이 8 생성기와 PK 충돌 8회 제한 재시도
- 기존 행: run/file source 값에서 안정적으로 생성한 `r`/`f` 접두 8자리 값이며, 충돌·NULL preflight 후에만 키 전환
- 기존 숫자 run PK는 `legacy_raw_run_sequence`로 명시 보존하며 runtime identity로 사용하지 않음
- 기존 `created_at`, `completed_at`, `imported_at`은 각각 nullable `legacy_created_at_utc`, `legacy_completed_at_utc`, `legacy_imported_at_utc` `DATETIME(3)`에 밀리초까지 원형 보존
- 감사4: `INSERT_USER`, `INSERT_TIME`, `UPDATE_USER`, `UPDATE_TIME`; KST `YYYY-MM-DD HH:MM:SS`
- Common Staging은 `raw_landing_run_id`로 COMPLETE run과 파일을 읽음
- 같은 COMPLETE bundle 재실행은 payload/hash/행수/byte parity만 확인하고 DML 0
- correction 이후 생성되어 legacy sequence가 없는 행은 migration442 shape rollback을 fail closed

## 집중 검증

```text
npm.cmd run typecheck
PASS

node --import tsx --test \
  test/data-migration-raw-landing.test.ts \
  test/data-migration-raw-landing-standard-correction.test.ts \
  test/data-migration-common-staging.test.ts
PASS 10/10

RUN_MARIADB_INTEGRATION=true node --import tsx --test \
  test/data-migration-raw-landing-mariadb.integration.test.ts \
  test/data-migration-common-staging-mariadb.integration.test.ts
PASS 2/2

npm.cmd run build
PASS

npm.cmd run object-data:validate
PASS: canonical manifest 98 tables

node --import tsx scripts/validate-object-data-model-contract.ts \
  ../migration-control/contracts/object-data-model-raw-landing-correction.v1.json
PASS: amendment 2 tables
```

전체 `npm test`는 Lease 지시대로 실행하지 않았다.

## 실제 MariaDB amendment/rollback 리허설

전용 스키마:

- `hoibot_rehearsal_raw_landing_2552`
- `hoibot_rehearsal_raw_landing_2552_rollback`
- `hoibot_rehearsal_raw_2552_guard_run`
- `hoibot_rehearsal_raw_2552_guard_file`

순서:

1. migration442 적용 후 합성 run 1행/file 1행, payload 4 bytes 적재. 시각 fixture는 `created_at=2026-09-05 01:02:03.123`, `completed_at=2026-09-05 01:02:04.456`, `imported_at=2026-09-05 01:02:05.789`
2. migration443·457 및 migration476 적용
3. run/file 행수 `1/1`, 합계 `4 bytes`, `SHA2(payload)=source_content_sha256` 확인
4. forward에서 세 legacy provenance 값이 `.123/.456/.789`까지 각각 exact equality `1/1/1`; 감사 KST 문자열은 표준 초 단위 형식으로 별도 생성
5. bare `id`, `run_id`, `created_at`, `completed_at`, `imported_at` 최종 잔존 `0`
6. FK 1개 존재, child/parent FK type·charset·collation 동일 `1`
7. 감사4 컬럼 두 테이블 합계 `8`
8. 실제 repository 최초 적재, exact replay, 연결 close/reopen 후 restart replay, rollback 및 Common Staging handoff 통과
9. 별도 rollback 스키마에서 migration476 rollback 실행 후 run/file `1/1`, `4 bytes`, payload hash, 숫자 PK/FK와 UTC created/completed/imported `DATETIME(3)`의 `.123/.456/.789` 값·HEX 표현 모두 원형 일치 `1/1/1/1/1/1`

## 독립 리뷰 P1 보완

- P1-1 fractional seconds 영구 손실: 세 nullable legacy temporal provenance 컬럼과 직접 rollback 복원으로 보완
- P1-2 rollback mirror 누락: `migration-control/rollback/476_data_migration_raw_landing_standard_correction.sql` 추가
- runtime rollback SHA256: `3543261ea0fd5b948022ee9472f8b13eecfbe91686d7aed12cc4c6756f6a3f8e`
- migration-control mirror SHA256: `3543261ea0fd5b948022ee9472f8b13eecfbe91686d7aed12cc4c6756f6a3f8e`
- mirror hash equality: `true`

## 최종 rollback preflight P1 보완

rollback 파일의 첫 실행문인 preflight SELECT가 다음을 DDL/DML 전에 차단한다.

- baseline run(`legacy_raw_run_sequence IS NOT NULL`)의 `legacy_created_at_utc IS NULL`
- baseline run 소속 file의 `legacy_imported_at_utc IS NULL`
- `legacy_completed_at_utc`는 migration442에서 원래 nullable이므로 임의 NOT NULL 조건을 추가하지 않음

별도 격리 스키마 결과:

| 주입 케이스 | rollback | schema SHA 전/후 | data SHA 전/후 | rollback `run_id` 컬럼 흔적 |
| --- | --- | --- | --- | --- |
| `legacy_created_at_utc=NULL` | `FAIL_CLOSED` | `72c8eac9720a06695e87f06029979305156285d0dae504dad4397ac2b559caec` 동일 | `a675239c43ba42ae70f072850ab076702d55fe126681198d6ef4633b46cae2d0` 동일 | `0` |
| `legacy_imported_at_utc=NULL` | `FAIL_CLOSED` | `72c8eac9720a06695e87f06029979305156285d0dae504dad4397ac2b559caec` 동일 | `5368d8bc90cd354f8517bef5c783520b46d36a79013b7f4b2f07b852bec5e030` 동일 | `0` |

## 정리와 불변

- 전용 스키마 잔존: `0`
- 전용 사용자 잔존: `0`
- 컨테이너 `/tmp/lease2552_*` 잔존: `0`
- 운영 JSON 읽기/쓰기: 없음
- 운영 DB·실운영방·외부 reply/network: 없음
- `feature/prod`, Gate8: 변경 없음

## 잔여 위험

- 기존 행의 8자리 backfill hash는 충돌 시 migration이 fail closed 하므로, 큰 실제 이관 전에는 사전 충돌 검사를 다시 수행해야 한다.
- correction 이후 신규 CUID2 행은 숫자 legacy identity가 없으므로 migration442 구조로의 schema rollback 대상이 아니다. 해당 경우 export/forward-fix 결정을 먼저 해야 한다.

# WBS742 Gate 5 V4 격리 DB 검증

- Lease: `2631`
- CONTROL: `슬라이스_보고수신!5642`
- 기준 커밋: `f7961b3fca90f107cecd4defe4824029c854067d`
- 실행 방식: loopback isolated MariaDB, synthetic data only
- catalog version: `SC-20260902-1`
- delta ID: `SCD-WBS742-G5-20260909-1`
- evidence schema version: `object-domain-import-gate5-evidence-v1`

전용 포트 `3364`와 전용 schema `hoibot_rehearsal_wbs742_v4_gate5`에서 migration 480개를 fresh 적용했다. V4 정책은 119 registered tables, 47 direct targets, 263 columns, 25 definition targets, 49 projection rows, 272 compared values를 그대로 유지했다.

fresh import는 기존 target 2행에서 49행을 추가해 51행이 되었고 import run 1개, decision 13개, record 49개를 생성했다. case-sensitive `member.bag`/`item` linkage의 `ITEM_STACK` PROJECT와 `BAG_CONTAINER` IGNORE witness를 확인했고, witness owner 변조는 `OBJECT_DOMAIN_IMPORT_ITEM_BAG_WITNESS_INVALID`로 fail-close했다. 원상복원 뒤 정상 import가 성공했으며 강제 trigger 실패는 target·run·decision·record 수를 모두 보존했다.

MariaDB 프로세스를 종료하고 새 프로세스로 재시작한 뒤 exact replay가 true이고 모든 count가 불변임을 확인했다. rollback 1건 후 target은 51행에서 원래 2행으로 돌아왔고 import run·decision·record는 0행이 되었다. upstream projection run 1개와 projection record 49개는 보존됐다.

실행 전후 `3364` listener가 없음을 확인했다. 운영 포트 `3306`의 소유 PID는 실행 전후 모두 `4872`였고 운영 DB와 운영 데이터에는 접근하지 않았다.

검증 결과:

- isolated MariaDB fresh/tamper/forced rollback/restart/replay/rollback: `PASS`
- Gate3·Gate4·V2·V4 focused regression: `19/19 PASS`
- TypeScript typecheck/build: `PASS`
- PowerShell parser, diff check, strict UTF-8 decode: `PASS`

기존 Gate1~4 evidence, V1/V2 exact-schema 계약·test·evidence, WBS779/WBS782 evidence, importer, CLI, migration runner, migrations, 공용 ledger/residual을 수정하지 않았다. `feature/prod`와 Gate8 작업은 수행하지 않았다.

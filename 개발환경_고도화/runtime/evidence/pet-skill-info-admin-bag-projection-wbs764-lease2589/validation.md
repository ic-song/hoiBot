# WBS764 / Lease2589 관리자 펫스킬가방 SHADOW 검증

- 실행: `펫스킬관리자가방DB-SL-PET-SKILL-INFO-ADMIN-BAG-PROJECTION-01-202609071635`
- 기준: `5e6810d9f961a8270ed26ce3f6df039a0c4174b2`
- 범위: `/펫스킬정보` 관리자 닉네임 조회의 공용 READ_ONLY recovery 소비, 방별 권한, 8 marker slot, import/catalog/stack completeness, 레거시 exact formatter.
- 비범위: DIRECT, 외부 reply/outbox, private HoiPass, dev UI, 운영 데이터 seed/import.

## Focused 검증

- pet-skill service/migration/recovery ingress/actual HTTP: PASS.
- common READ_ONLY recovery provider 13개 + command ingress + buildApp.inject composition: PASS.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `npm run object-data:validate`: PASS, 신규 authority/rank/completeness 3개 포함.
- `git diff --check`: PASS.

## Isolated MariaDB Gate2/3

- 명령: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/rehearse-pet-skill-info-admin-bag-projection-wbs764.ps1`
- 격리 경계: MariaDB 12.2, `127.0.0.1:3334`, fresh disposable datadir/database `hoibot_wbs764_admin_bag_projection`; 운영 3306 listener 불변; 종료 후 listener/datadir 정리.
- 최종 transcript: `WBS764_ISOLATED_MARIADB_PASS forward=true syntheticExact=true tamperFailClosed=true restart=true rollbackPreflightDenied=true rollbackRetryDenied=true rollback=true reforward=true permissionPreserved=true port=3334 production3306Unchanged=true`.
- 실제 확인: migration 473개 적용, canonical pet-skill 93 definitions/30 aliases/4 policies seed, authority 1, frozen marker slots 8, migration460 import-run FK completeness 1, owned stack 1.
- projection exact: `[💞대상] ... [3/100]` 및 1개 formatted skill row를 actual snapshot service로 확인.
- tamper: receipt의 stack-set fingerprint를 갱신하지 않고 quantity를 3→4로 바꾸면 `ADMIN_PLAYER_BAG_PROJECTION_UNPROVEN` fallback, 3 복구 후 restart에서 exact projection 재확인.
- rollback: populated 상태에서 `ROLLBACK_485_PROJECTION_ROWS_EXIST`로 DROP 미실행 및 3 tables 존속; 같은 rollback 재호출도 helper procedure 충돌 없이 재차 거부; 합성 projection 정리 후 rollback 성공; forward 재적용 성공; shared permission와 manager/super_admin grants 보존.

## 실행 중 발견 및 보정

- MariaDB errno 1901: `CHAR(8)` player ID 기반 generated active key를 거부해, boolean-only nullable guard + `(player_id,active_player_guard)` unique로 교정.
- Maria CLI `source`는 scalar preflight 오류 후 후속 DROP을 계속할 수 있어, rollback DROP을 stored procedure의 `IF EXISTS ... SIGNAL` 뒤에 배치해 실제 fail-close로 교정.

## 잔여 위험

- P0: 없음.
- P1: 실제 운영 room external ID, operator crosswalk, 8 marker 값, per-player import completeness는 별도 운영 데이터 이관 전까지 의도적으로 fallback.
- P2: 운영 Shadow 관찰 및 formal receipt 발행은 후속 Gate이며 이번 실행에서 수행하지 않음.
- 금지 범위인 full suite, T3, Gate8, 운영 DB/운영 데이터, feature/prod는 실행하지 않음.

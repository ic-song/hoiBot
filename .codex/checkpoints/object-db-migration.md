# 작업 복구 체크포인트

- 작업 키: object-db-migration
- 작업 이름: SC-20260902-1 오브젝트 데이터 DB화
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 정리 후보 기준 커밋:
- 체크포인트 버전: 7
- 마지막 갱신: 2026-09-03 22:45 KST

## 현재 목표

- WBS730~744 Gate 1~7 구현·검증 후 WBS745 운영배포 자동화를 최종 Gate 8에서 수행한다.

## 사용자 요청과 승인 범위

- 최신 요청: 오브젝트 DB화 개발을 병렬로 계속 진행한다.
- 허용된 변경: 계약, migration, provider/repository/service, 합성 fixture, 테스트, 검증 근거, WBS 현행화.
- 별도 승인이 필요한 작업: 운영 DB 쓰기, 운영 배포, 저장소 운영 snapshot 변경, feature/prod 반영.
- 선언된 파일 범위: `.codex/checkpoints/object-db-migration.md`; `개발환경_고도화/migration-control`; `개발환경_고도화/runtime`.

## 작업 위치

- 저장소: hoiBot
- 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\object-db-import-v1-20260903`
- 브랜치: `codex/object-db-import-v1-20260903`
- 마지막 기준 커밋: `10690cf0`
- 마지막 푸시 커밋: 없음
- 원격 동기화 상태: 미확인·미푸시
- 체크포인트 Git 추적: 아니요
- 체크포인트 포함 푸시 커밋: 없음

## 완료된 작업

- WBS742 Gate1/2에서 65개 disposition과 45개 직접 대상 테이블을 분류했다.
- 45개 테이블의 비감사 컬럼 241개에 실제 SQL type/nullability/migration 계약을 추가했다.
- 타이틀 1-based, 장착 미니펫 별도 occurrence, 가구 rate=뽑기 확률 해석을 실제 코드·snapshot 테스트로 고정했다.
- 40개 generated CUID PK와 5개 reused PK의 locator binding 계약을 추가했다.
- migration 454에서 crosswalk payload fingerprint와 caller transaction 기반 import binding을 추가했다.
- migration 455에서 타이틀 3종 occurrence별 acquisition_price를 분리했다.
- migration 456에서 미니펫 custom_name/custom_emoji와 item/pet/equipment ownership 상태 CHECK를 추가했다.
- 건물 중복 floor의 첫 행 우선, 미니펫 자동 정의 추론 금지, 가구 정의 미해결/모호 격리 경계를 실제 snapshot 수치로 고정했다.
- WBS724 Common Staging `c9db0e82`와 WBS725 Catalog Projection 및 구 migration 458 재생 호환성 보정 `d6a62104`를 fast-forward로 통합했다.
- WBS742 Gate3 비식별 합성 fixture와 Gate4 atomic domain importer를 구현했다. 45개 직접 대상, 241개 필드, 23개 정의/규칙 대상을 축소 없이 사전 검증하고 정의를 보유보다 먼저 기록한다.
- migration 460에 import run/decision/record 영수증 3개 테이블과 역순 rollback을 추가했다. exact replay는 canonical row까지 재검증하고 쓰기 0건으로 종료하며, 중간 실패는 identity/target/receipt/run 전체를 rollback한다.
- Catalog Projection COMPLETE envelope, 별도 migration 458 manifest hash, migration 459 upstream envelope, decision/record fingerprint를 독립적으로 재검증한다.
- WBS725 portable schema-hash correction `69a72a2d`를 fast-forward 통합하고, importer도 동일한 canonical semantic target-schema SHA-256 helper를 사용하도록 맞췄다.
- WBS742 Gate3/4를 독립 reviewer P1/P2 0과 전체 회귀 후 `fd3f11a3`으로 커밋했다.
- Gate5 격리 harness에서 신규 MariaDB 12.2에 migration 448개를 적용하고 forced-failure 원자 rollback, 47행→45 target 실이관, PID가 바뀐 재시작 후 exact replay 0-write, 47행 역순 rollback 및 upstream/identity 보존을 재현했다.
- 실DB 재시작 대사로 DECIMAL scale 차이(`1` 대 `1.0000000000`)를 발견해 정밀도를 잃지 않는 SQL-type 대칭 canonical comparator와 회귀 반례를 추가했다.
- WBS742 Gate5를 독립 reviewer P1/P2 0과 전체 회귀 후 `10690cf0`으로 커밋했다.
- Gate6 독립 oracle은 importer replay 검증을 재사용하지 않고 projection 47행의 identity/PK/FK와 45개 target, 241개 schema field를 실제 격리 MariaDB에서 전수 대사한다.
- Gate5 decision `12=12/0/0`과 Gate6 decision `14=12/1/1`은 별도의 새 DB fixture 목적 차이로 구분했고, 두 경우 모두 projection record는 47개이다.

## 진행 중인 작업

- WBS742 Gate6 독립 parity verifier와 실DB 반례 harness/evidence를 구현했다. 전체 회귀와 독립 reviewer 판정을 준비한다.

## 변경 파일

- `개발환경_고도화/migration-control/contracts/object-domain-import-*.v1.json`
- `개발환경_고도화/migration-control/evidence/object-db-domain-import/*`
- `개발환경_고도화/runtime/test/object-domain-import-*.test.ts`
- `개발환경_고도화/runtime/migrations/454*`, `455*`, `456*`
- `개발환경_고도화/runtime/src/identity/object-identity-audit-provider.ts`
- `개발환경_고도화/runtime/src/data-migration/object-domain-importer.ts`
- `개발환경_고도화/runtime/scripts/import-object-domain.ts`
- `개발환경_고도화/runtime/migrations/460*`
- `개발환경_고도화/migration-control/contracts/data-migration-object-domain-import.v1.json`
- `개발환경_고도화/migration-control/fixtures/synthetic-relational/data-migration-object-domain-import-v1.json`
- `개발환경_고도화/runtime/scripts/rehearse-object-domain-import-gate5.ps1`
- `개발환경_고도화/runtime/src/data-migration/object-domain-parity-verifier.ts`
- `개발환경_고도화/runtime/test/object-domain-import-parity-verifier.test.ts`

## 검증

- 실행 명령: Gate5 격리 MariaDB harness, Gate6 격리 MariaDB independent parity harness, Gate1~6 focused suite, object-data validator, typecheck, build, diff-check.
- 현재 결과: Gate5는 이전 커밋 근거대로 완료. Gate6는 migration 448개, prepare importer `25/25`, parity `2/2`; source decisions `14=12 PROJECT+1 QUARANTINE+1 IGNORE`, projection/target `47/47`, 45 tables, 241 fields/250 values, definition order `24<25`, canonical hash 동일, diff 0, verifier DML counter 불변. missing/extra/value/FK redirect/decision/order, persisted run/component hash, receipt identity/imported-row fingerprint drift는 fail-closed 후 복원 parity PASS. PID `13016`, cleanup 후 3321 listener/temp 제거 및 3306 PID `5328` 불변. focused `48/48`, Catalog 포함 `60/60`, 전체 `1789 PASS / 8 SKIP / 0 FAIL`(`1797` tests), validator 등록73/typecheck/build/diff PASS.

## 충돌·막힘·미승인 사항

- 운영 DB/운영 배포/feature-prod 반영은 승인되지 않았다.

## 다음 행동

1. 독립 reviewer 승인 후 WBS742 Gate6를 한국어 커밋으로 고정한다.

## 보안

- 비밀 값, 평문 자격 증명과 불필요한 개인정보를 기록하지 않는다.

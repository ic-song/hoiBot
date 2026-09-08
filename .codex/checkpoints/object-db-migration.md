# 작업 복구 체크포인트

- 작업 키: object-db-migration
- 작업 이름: SC-20260902-1 오브젝트 데이터 DB화
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 10
- 마지막 갱신: 2026-09-08 11:41 KST

## 현재 목표

- WBS730~744 Gate 1~7을 완료하고 마지막에 WBS745 Gate 8 비운영 배포·복구 준비만 수행한다.
- 운영 데이터 최종 적재, 운영 cutover, 실운영방·운영 DB·feature/prod 반영은 별도 승인 전 금지한다.

## 현재 작업 위치

- 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\item-bag-canonical-read-v1-20260908`
- 브랜치: `codex/item-bag-canonical-read-v1-20260908`
- HEAD: `4f7492f980bf95744b3f0eb4f9e8717cc4dd50d3`
- 상태: WBS776 변경 미커밋·미푸시
- 체크포인트 Git 추적: 기존 추적 파일, 이번 갱신은 미커밋
- 원격 포함 커밋: 없음

## 완료된 현재 슬라이스 작업

- `/가방|ㄴㄴㄴ` 실제 Iris 유입을 command registry가 결정한 SHADOW 경로로 연결하고 canonical 평가 이후의 legacy reply와 SHADOW receipt를 단일 root transaction으로 묶었다. LEGACY_ONLY는 기존 legacy 경로를 유지한다.
- SHADOW 평가 오류와 silent 결정은 transitional legacy outbox를 만들지 않으며 MODERN 경로는 노출하지 않는다.
- active 부계정, world castle, owner marker/rank, operation notice, import readiness를 fail-close로 조립했다.
- Maria 테스트는 전용 `ITEM_BAG_TEST_DB_*`, exact destructive arming, 로컬 host/port/user/schema, seed 전·pool 재구성 후 DB identity 검증을 요구한다.
- 기존 Wave6 `BagShadowParityProvider.compare`는 baseline과 byte-exact 복원했다.
- owner/import 신규 SQL consumer 2개를 ITEM/READ `STATIC_ONLY`로 registry에 additive 등록했다.
- 공식 manifest: 1132 consumers, SQL_REPOSITORY 83, consumer set SHA-256 `b722adc73e5baecb694587d57c45e0989b72442ccaa12d7e7c0490840b5c425f`.
- 공식 ledger: 1132 entries, DIRECT_PASS 31 유지, STATIC_ONLY 1019, entry set SHA-256 `1ffc1ad88fe31ed708df38e25b7a4eb2b142aa709201b2d991a3362627c37bf7`; validator PASS.
- focused/shared 77/77 PASS; 강화된 격리 Maria guard+실증 4/4 PASS; transition 14/14, build, object-data validator, main/Info syntax, `git diff --check` PASS.
- 완료 replay는 정상 root와 failure-reconciliation COMPLETED 분기 모두에서 연결된 legacy outbox를 검증한다. 누락·중복·payload·destination·status·type drift를 거부하며, linked import record의 불가능한 zero-row COMPLETE도 거부한다.
- `COMMAND_INDEX.md`와 WBS776 evidence를 현재 SHADOW 경계로 동기화했다.

## 현재 변경 범위

- `COMMAND_INDEX.md`
- `개발환경_고도화/migration-control/contracts/object-db-consumer-*.json`
- `개발환경_고도화/migration-control/evidence/item-bag-canonical-shadow-lease2604/`
- `개발환경_고도화/runtime/src/app.ts`
- `개발환경_고도화/runtime/src/dispatch/app-wiring-read-only-recovery-provider.ts`
- `개발환경_고도화/runtime/src/inventory/*item-bag*`, `legacy-bag-owner-label-provider.ts`
- 관련 runtime tests

## 미완료 검증과 주의점

- 독립 reviewer의 최종 재검토, task branch 커밋·push, WBS776/lease2604 현행화가 남았다.
- 같은 Node 프로세스의 app/pool 재구성만 증명했으므로 문서에서 실제 process restart라고 주장하지 않는다.
- 전체 도메인 DML0/network0이 아니라 read-only evaluator, fixture quantity 불변, immediate Iris reply callback 0으로만 주장한다.
- zero-row/post-import completeness, 전체 item instance/equipment/pet coverage, MODERN/DIRECT receipt는 여전히 차단점이다.

## 정확한 다음 행동

1. 최종 변경과 증적을 독립 reviewer가 재검토한다.
2. 검토 결과를 반영한 뒤 task branch를 커밋·push한다.
3. WBS776/lease2604를 실제 Gate 증거와 남은 차단점 기준으로 현행화한다.

## 승인 경계

- 운영 DB·운영 JSON 쓰기, 실운영방, feature/prod, 운영 배포·cutover는 승인되지 않았다.
- 비밀 값과 평문 자격 증명은 체크포인트에 기록하지 않는다.

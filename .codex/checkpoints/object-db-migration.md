# 작업 복구 체크포인트

- 작업 키: object-db-migration
- 작업 이름: SC-20260902-1 오브젝트 데이터 DB화
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 23
- 마지막 갱신: 2026-09-09 10:39:00 KST

## 현재 목표

- WBS730~744 Gate 1~7을 완료하고 마지막에 WBS745 Gate 8 비운영 배포·복구 준비만 수행한다.
- 운영 데이터 최종 적재, 운영 cutover, 실운영방·운영 DB·feature/prod 반영은 별도 승인 전 금지한다.

## 전체 감사 현황

- WBS730~732: 완료.
- WBS733~741: Gate1~4 완료, Gate5~7 잔여.
- WBS742: 현행 25%, 후속 검증 필요.
- WBS743: 공식 ledger는 1,133건, DIRECT_PASS 41, STATIC_ONLY 1,010, BLOCKED_DYNAMIC 82이며 미증명 consumer 1,092건이다. 잔여 작업표는 재사용 증명 자산 5, 엄격 동등성 10, 직접 실행 995, 선행 보완 82로 완전 분할됐고 WBS787~791 증분 증거는 아직 shared ledger 승격 전이다.
- WBS744: 현행 62.5%, Gate6~7 잔여.
- WBS745: 전체 Gate8 비운영 배포·복구 준비이며 WBS730~744 Gate1~7 종료 후 착수.
- WBS779~785: Gate1~7 완료, 공식 검증과 Lease 종료. WBS785 aggregate `8cf572b4`는 origin과 일치한다.
- WBS786: Gate1~7 완료, 공식 종료. source `4f481a7d`, aggregate `24fac92e`, focused20/20, Maria6, receipts225, DIRECT_PASS 41이다.
- WBS787~789: 가구 배치·미니펫 획득·펫스킬 지급 증분 구현과 격리 검증을 완료해 aggregate에 통합했다. 공용 원장 승격 전이므로 Gate1~5, 62.5%로 유지한다.
- WBS790~791: 아이템 스택 수량 mutation과 app-wiring 상위 root retry를 구현·검증해 aggregate `4dc632fb`에 통합했다. WBS790 focused44/44+Maria8, WBS791 focused70/70+typecheck/build이며 둘 다 Gate1~5, 62.5%다.

## 현재 작업 위치

- 통합 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\item-bag-canonical-read-v1-20260908`
- 통합 브랜치: `codex/item-bag-canonical-read-v1-20260908`
- 통합 현재 SHA: `7f6e85477b7ff2e68e70ffd3211c21a376134ce4`
- 현재 실행 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\object-db-parity-wave23-v1-20260909`
- 현재 실행 브랜치: `codex/object-db-parity-wave23-v1-20260909`
- 현재 실행: WBS787~789 / Lease2619 범위 / Wave23 shared ledger receipt 18건 작성·봉인
- 상태: 중단 당시의 Wave23 미커밋 7파일을 보존해 동일 에이전트가 재개함. 잔여 작업표와 통합 기준선은 완료 상태로 재사용하며 다시 만들지 않는다.
- 체크포인트 Git 추적: 기존 추적 파일
- 원격 상태: 통합 브랜치 `7f6e8547`까지 origin과 exact 일치. Wave23 변경은 아직 미커밋이며 별도 전용 브랜치에만 존재한다.

## 완료된 현재 슬라이스 작업

- `/가방|ㄴㄴㄴ` 실제 Iris 유입을 command registry가 결정한 SHADOW 경로로 연결하고 canonical 평가 이후의 legacy reply와 SHADOW receipt를 단일 root transaction으로 묶었다. LEGACY_ONLY는 기존 legacy 경로를 유지한다.
- SHADOW 평가 오류와 silent 결정은 transitional legacy outbox를 만들지 않으며 MODERN 경로는 노출하지 않는다.
- active 부계정, world castle, owner marker/rank, operation notice, import readiness를 fail-close로 조립했다.
- Maria 테스트는 전용 `ITEM_BAG_TEST_DB_*`, exact destructive arming, 로컬 host/port/user/schema, seed 전·pool 재구성 후 DB identity 검증을 요구한다.
- 기존 Wave6 `BagShadowParityProvider.compare`는 baseline과 byte-exact 복원했다.
- owner/import 신규 SQL consumer 2개를 ITEM/READ `STATIC_ONLY`로 registry에 additive 등록했다.
- 공식 manifest: 1133 consumers, SQL_REPOSITORY 84, consumer set SHA-256 `015ed7d96a4579c84d170888151e44a36cf95192760555966ac47df0764ffb3a`.
- 공식 ledger: 1133 entries, READ 504, MUTATION 629, DIRECT_PASS 33, STATIC_ONLY 1018, BLOCKED_DYNAMIC 82, missing/duplicate 0, entry set SHA-256 `775a00e4ef73f19361bab6d3a057984ffb4902a1afadc5167067edea7ce5a882`; builder/AJV validator PASS.
- focused/shared 77/77 PASS; 강화된 격리 Maria guard+실증 4/4 PASS; transition 14/14, build, object-data validator, main/Info syntax, `git diff --check` PASS.
- 완료 replay는 정상 root와 failure-reconciliation COMPLETED 분기 모두에서 연결된 legacy outbox를 검증한다. 누락·중복·payload·destination·status·type drift를 거부하며, linked import record의 불가능한 zero-row COMPLETE도 거부한다.
- `COMMAND_INDEX.md`와 WBS776 evidence를 현재 SHADOW 경계로 동기화했다.
- WBS777 아이템 가방 이관 완전성 기준선 보정을 독립 Gate7 GO로 확정하고 `a988742b`로 WBS776 브랜치에 통합했다.
- WBS777 공식 WBS는 Gate1~7 TRUE, 100%, COMPLETE이며 lease2605는 RELEASED다.
- WBS778의 initial lineage/Maria false-positive 차단점은 `6ff02522`, `c568ad86`, `4a8fe1b8` 보강과 독립 Maria 재실행으로 해소됐으며 해당 원본 브랜치 커밋은 origin에 포함됐다.
- WBS776 분류 보정 addendum은 `/가방`의 실제 의존 범위를 ITEM_STACK_BAG + RANK_GUILD_PRESENTATION으로 좁히되 WBS778 증거가 없거나 변조되면 축소를 적용하지 않는다.
- WBS776 addendum은 WBS778 runtime contract, projector, readiness provider, migration의 exact path·canonical SHA-256과 version/NO_WRITE/schema 의미, 실제 `main.js` 함수·가방 anchor 재추출을 fail-close로 결박했고 독립 검토 GO를 받았다.
- 실제 app wiring은 `LegacyRankLabelSideEffectReadinessProvider`가 준비되지 않으면 bag parity 실행 전 `LEGACY_SIDE_EFFECT_PARITY_UNPROVEN`으로 무응답 처리하도록 연결됐다.
- manifest production re-derive는 WBS778 통합 후 PASS했고 신규 SQL consumer `sql-repository-3b23c2f0f5501988`를 포함해 1133 consumers / SQL_REPOSITORY 84로 계산됐다.
- WBS778 CRLF/LF 보정은 새 `core.autocrlf=true` checkout 독립 GO까지 완료했고 공식 WBS778 Gate1~7은 TRUE, 100%, COMPLETE, lease2606 RELEASED다.
- Wave17은 evidence commit `5e8495e2`에 대해 Wave16 167 receipt 불변 prefix와 신규 15 receipt를 합쳐 총 182개를 봉인했다. 세 ITEM READ SQL provider는 exact output, wrong environment/operation, tamper, child restart를 모두 READ_ONLY/DML0으로 통과했다.
- Wave6 `sql-repository-3001ad9fc2f36d01`의 과거 receipt는 current source span과 달라 provenance만 보존하고 current ledger에서는 STATIC_ONLY로 유지한다.
- 1차 독립 Gate7이 찾은 manifest count, app/current source hash, readiness source term, stable-ID lifecycle 불일치를 보정했다. 제거된 pet-skill runtime identity 6개는 TOMBSTONE으로 예약하며 targeted stable/transition test는 23/23 PASS다.
- 동일한 독립 검토 focused 명령을 재실행해 transition/ledger/Wave17/stable-ID/WBS777/WBS778/실제 SHADOW ingress 65/65 PASS를 확인했다. typecheck, build, object-data 119, main/Info syntax, diff check도 PASS다.
- origin `909fc1ab`의 fresh detached checkout 독립 재검토는 GO이며 P0/P1/P2가 모두 0이다.
- 공식 시트 WBS776은 Gate1~7 TRUE, Gate8 FALSE, 100%, `최종 검증 완료`로 갱신했고 검증11226은 완료, Lease2604는 RELEASED다. 기존 CONTROL5625는 SUPERSEDED, CONTROL5626은 WBS730~744 전체 감사 ACTIVE로 승계했다.
- 전체 감사 P1 세 건을 WBS779/Lease2607로 분리했다. exact migration 계약은 현행 39개와 484/485를 포함하며, additive V4 disposition은 V1 90개와 후속 29개를 합쳐 등록 테이블 119개를 정확히 한 번씩 분류한다.
- V4 target-schema/field-map은 `canonical_pet_skill_definitions`의 후속 11컬럼을 결박하고, migration 482 Unicode grade amendment와 migration 485 admin projection 경계를 명시한다. 불변 V1/V2 계약과 적용 migration은 수정하지 않았다.
- importer CLI는 V1~V4를 명시 선택한다. V1 pre-466 호환 allowlist는 유지하고 V2/V3/V4는 각 생성 profile의 current semantic contract만 허용한다.
- WBS779 1차 독립 검토가 실제 V4 policy의 effective V2 component hash 불일치, 263컬럼 preflight 부재, V2 semantic freeze 훼손, catalog-projection V4 upstream 부재를 P1으로 재현했다. 이를 보정해 두 CLI가 V4를 선택하고 동일한 263컬럼 schema hash를 사용하며, 실제 CLI-equivalent policy가 importer preflight를 통과한다.
- WBS779 focused `88/88`, V2/V3/V4 profile subset `19/19`, disposable MariaDB `4/4`, typecheck/build/object validator 119/main·Info syntax가 통과했다. 운영 데이터·DB·실방·외부 전송·feature/prod·Sheets는 변경하지 않았다.
- WBS780 V4 target/schema manifest 불일치 8건을 0건으로 보정하고 aggregate `7f38cf28`에 통합했다.
- WBS782 격리 MariaDB fresh rerun에서 migration 478, max 490, replay 0, 등록 migration 39, tables 119, effective columns 263, direct 47, shadow 45를 확인했고 WBS744 Gate5를 완료했다.
- WBS781 Wave18 READ4는 202 receipts, DIRECT 37, STATIC 1,014, BLOCKED 82로 독립 Gate7 GO를 받았다.
- WBS783 Wave19 PACKAGE 상태 조회는 5 receipts를 추가해 총 207, DIRECT 38, STATIC 1,013, BLOCKED 82를 만들었다. ancestry-only merge 뒤 source `7186b012`, aggregate `78f3740e`, 독립 재검토 27/27 PASS와 P0/P1/P2 0건을 확인했다.
- WBS784 Wave20 PACKAGE import는 공용 mutation evidence를 추가하고 실제 repository를 격리 MariaDB에서 success 26 committed rows, 중간 DML 13 전량 rollback, duplicate·drift·restart DML0, concurrency writer 1로 증명했다. 초기 독립 재검토의 P1 3건을 repository-local retry/reconciliation·module identity·immutable oracle로 보정한 뒤 fresh Maria 5/5, tamper 11/11, full ledger 16/16을 통과했다. receipts 213, DIRECT 39, STATIC 1,012이며 aggregate `549a173b`가 origin과 일치한다.
- WBS785 Wave21 PET_EQUIPMENT assign은 requestKey 182자까지 legacy raw locator를 보존하고 183자부터 SHA-256으로 전환한다. replay-first 잠금, player/pet/equipment 소유·활성 fail-close, exact 1062와 1213/1205 transaction retry/reconciliation을 적용했다.
- WBS785는 repository 8/8, mutation 15/15, 구현자 full ledger 17/17, 격리 Maria 구현자 5회와 독립 1회를 통과했다. success DML 6, 중간 DML 4 전량 rollback, replay·drift·restart DML0, concurrency writer 1이며 receipts 219, DIRECT 40, STATIC 1,011, BLOCKED 82다. source `a9f2cb51`, aggregate `8cf572b4`는 origin과 일치한다.
- WBS786은 FURNITURE grant mutation 6개 시나리오를 Wave22 shared ledger에 승격해 receipts225, DIRECT41, STATIC1,010, BLOCKED82를 확정했다.
- WBS787~789는 가구 배치·미니펫 획득·펫스킬 지급의 success/rollback/replay/drift/restart/concurrency를 집중 검증했고 source와 aggregate를 origin에 push했다. 전체 회귀는 수행하지 않았다.
- WBS790은 item stack quantity mutation을 focused44/44와 격리 Maria8/8로, WBS791은 app-wiring opt-in root retry를 focused70/70과 typecheck/build로 검증했다. exhaustion은 exact 1213/1205 최대3, committed DML0, provider.fail0, reconciliation read0을 보장하며 aggregate `4dc632fb`가 origin과 일치한다.
- 잔여 작업표는 manifest/ledger 전체 ID 집합·중복·내부 SHA·base commit·verdict를 fail-close로 검증한다. 1,092건을 재사용 증명 자산 5, 엄격 동등성 10, 직접 실행 995, 선행 보완 82로 정확히 한 번씩 분류하며 결정적 재생성 4/4와 독립 P0/P1 0건을 통과했다. 재사용 자산은 완료 증거가 아니라 재실행 또는 공식 재봉인 대상이다.

## 현재 변경 범위

- `COMMAND_INDEX.md`
- `개발환경_고도화/migration-control/contracts/object-db-consumer-*.json`
- `개발환경_고도화/migration-control/evidence/item-bag-canonical-shadow-lease2604/`
- `개발환경_고도화/runtime/src/app.ts`
- `개발환경_고도화/runtime/src/dispatch/app-wiring-read-only-recovery-provider.ts`
- `개발환경_고도화/runtime/src/inventory/*item-bag*`, `legacy-bag-owner-label-provider.ts`
- 관련 runtime tests
- `.codex/checkpoints/object-db-migration.md`
- 체크포인트 반영 대상: 이 문서와 WBS776 최종 evidence 현행화

## 미완료 검증과 주의점

- WBS776 공식 진척은 Gate1~7 TRUE, Gate8 FALSE, 100%이며 WBS776 범위는 COMPLETE다.
- 1차 독립 Gate7의 P1은 `c5518e6d`에서 보정했고, `909fc1ab` fresh detached 재검토에서 focused 65/65 및 보조 검증이 모두 통과해 최종 GO를 받았다.
- `data-migration-object-domain-import.v3.json`은 Git 상태에 수정으로 보이지만 내용 diff는 없었다. 재개 시 line-ending 상태를 확인하고 의미 변경 없이 보존한다.
- 같은 Node 프로세스의 app/pool 재구성만 증명했으므로 문서에서 실제 process restart라고 주장하지 않는다.
- 전체 도메인 DML0/network0이 아니라 read-only evaluator, fixture quantity 불변, immediate Iris reply callback 0으로만 주장한다.
- WBS777은 zero-row/post-import continuation completeness를, WBS778은 rank/guild presentation no-write side effect를 증명한다. ITEM_BAG MODERN, 외부 DIRECT reply, 운영 데이터/DB/실방/Gate8은 이 Gate7 완료 주장에 포함하지 않는다.
- WBS787~791은 shared executable parity ledger에 아직 승격되지 않았으므로 Gate6과 Gate7을 완료로 표시하지 않는다.
- WBS791 독립 검토는 GO, P0/P1 0건, P2 3건이다. P2는 durable attempt_count 관측, lease 만료 경계, 전용 Maria harness 부재다.
- 전체 회귀는 각 증분에서 반복하지 않고 최종 고정 통합 후보에서 1회 수행한다. 광범위 변경 또는 영향 불명확 시에만 범위를 확대한다.

## 정확한 다음 행동

1. Wave23 신규 schema·fixture·harness·sealer로 WBS787~789의 각 REQUIRED 6개, 총 18개 receipt를 새로 실행·봉인한다. 기존 Wave22 225건 prefix는 byte-exact 보존한다.
2. WBS787~789를 shared ledger에 승격해 receipts 243, DIRECT_PASS 44, STATIC_ONLY 1,007, BLOCKED_DYNAMIC 82를 목표로 한다.
3. WBS790은 raw transaction owner 후속 보완과 sealed trace가 모두 끝난 뒤 별도 6개 receipt를 추가한다. 그 전에는 Gate6을 열지 않는다.
4. 잔여 작업표의 다음 작은 도메인 묶음은 MINI-PET-TITLE-COLLECTION 14 → MEMBER-TITLE 23 순으로 진행하며, CONTEXT-BRIDGE 12는 공유 경계 lease로 직렬화한다.
5. 전체 회귀는 증분마다 반복하지 않고 최종 고정 통합 후보에서 1회 수행한다. 광범위 변경 또는 영향 불명확 시에만 범위를 확대한다.

## 승인 경계

- 운영 DB·운영 JSON 쓰기, 실운영방, feature/prod, 운영 배포·cutover는 승인되지 않았다.
- 비밀 값과 평문 자격 증명은 체크포인트에 기록하지 않는다.

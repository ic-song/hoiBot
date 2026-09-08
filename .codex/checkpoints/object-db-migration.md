# 작업 복구 체크포인트

- 작업 키: object-db-migration
- 작업 이름: SC-20260902-1 오브젝트 데이터 DB화
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 16
- 마지막 갱신: 2026-09-08 18:31:17 KST

## 현재 목표

- WBS730~744 Gate 1~7을 완료하고 마지막에 WBS745 Gate 8 비운영 배포·복구 준비만 수행한다.
- 운영 데이터 최종 적재, 운영 cutover, 실운영방·운영 DB·feature/prod 반영은 별도 승인 전 금지한다.

## 현재 작업 위치

- 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\item-bag-canonical-read-v1-20260908`
- 브랜치: `codex/item-bag-canonical-read-v1-20260908`
- Gate7 검토 커밋: `909fc1ab` (origin task branch와 exact 일치)
- 상태: WBS777/WBS778 완료·통합, WBS776 Gate1~7 독립 GO·공식 100%·Lease2604 RELEASED. WBS730~744 잔여 전체 감사 진행 중
- 체크포인트 Git 추적: 기존 추적 파일
- 원격 상태: WBS776 Gate7 검토 기준 `909fc1ab`까지 origin task branch에 push 완료

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

## 정확한 다음 행동

1. 공식 시트와 저장소 증거를 기준으로 WBS730~744의 Gate1~7 완료 여부와 잔여 차단점을 전수 대사한다.
2. 발견된 잔여 구현 슬라이스만 새 선점과 독립 Gate 검토를 거쳐 완료한다.
3. WBS730~744가 모두 닫힌 뒤 WBS745 Gate8 비운영 배포·복구 준비로 넘어간다.

## 승인 경계

- 운영 DB·운영 JSON 쓰기, 실운영방, feature/prod, 운영 배포·cutover는 승인되지 않았다.
- 비밀 값과 평문 자격 증명은 체크포인트에 기록하지 않는다.

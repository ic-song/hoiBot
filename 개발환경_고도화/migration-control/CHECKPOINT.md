# 작업 복구 체크포인트

- 작업 키: `hoibot-rdb-migration`
- 작업 이름: hoiBot 전체 운영 시스템 RDB 이관
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 20
- 마지막 갱신: 2026-08-11 17:48 KST
- 대화 식별명: 전체 이관 제어면

허용 상태: `진행 중 → 검증 완료 → 작업 완료`

## 현재 목표

- 첫 변경 슬라이스 `/서버이동`의 legacy guard·권한·mutation·save flow와 기존 서버 구현을 재검증한다.

## 사용자 요청과 승인 범위

- 최신 요청: `DB 설계 → 임시데이터 적재 → 로직 이관 → 임시데이터 기반 검증 → 마지막 전체 운영 데이터 이관` 순서로 진행한다.
- 허용된 변경: 운영 원본 `data/*`는 수정하거나 DB에 적재하지 않고, 관계형 schema 설계와 개인정보 없는 임시 fixture·적재기·검증 기반을 구현한다.
- 별도 승인이 필요한 작업: 실제 운영 snapshot DB 적재, 운영 전환, `feature/prod` 반영, 기존 캐릭터 MVP 미커밋 변경 수정·정리.
- 선언된 파일 범위: `개발환경_고도화/DECISIONS.md`, `개발환경_고도화/migration-control/MASTER_PLAN.md`, `개발환경_고도화/migration-control/**`와 이후 승인된 관계형 migration·합성 데이터 적재기.

## 작업 위치

- 저장소: `https://github.com/ic-song/hoiBot.git`
- 작업 트리: `C:/Users/user/Desktop/hoiBot_modernization`
- 브랜치: `feature/modernization`
- 원격 저장소: `origin`
- 업스트림 브랜치: `origin/feature/modernization`
- 마지막 푸시 커밋: `03adf05a58935324e4ae7ec23566ca0cd7b861bf`
- 원격 동기화 상태: 로컬 HEAD와 upstream은 같지만 working tree가 dirty다.
- 체크포인트 Git 추적: 예
- 체크포인트 포함 푸시 상태: 현재 upstream HEAD 포함 여부를 resume checker로 판정

## 완료된 작업

- 단일 작업 체크포인트와 마스터 계획, 상세 증거 인덱스를 생성했다.
- 현재 상태를 `진행 중 → 검증 완료 → 작업 완료`로 단순화했다.
- 파일·Git 증거가 체크포인트와 다르면 실제 증거를 우선하도록 정했다.
- 저장소 내 다른 체크포인트를 검색했으며 현재 이관 체크포인트 하나만 확인했다.
- 새 resume checker의 파일 범위가 기존 캐릭터 MVP 미커밋 변경과 겹치지 않음을 확인했다.
- resume checker가 체크포인트 형식과 버전, 브랜치·HEAD·upstream, dirty worktree, artifact 추적·푸시 여부를 검사하도록 구현했다.
- JSON 33개 root hash와 MariaDB migration checksum, 동일 snapshot의 완료 import run을 읽기 전용으로 검사하도록 구현했다.
- 최초 제어면 생성 시 로컬 재개 가능, 다른 PC 재개 불가를 올바르게 판정했다.
- fetch 결과 `feature/modernization`은 원격과 동일하고 `origin/feature/prod`는 `288e6bd9626c88f5f3d658c593bfc462e72ca14e`로 전진했음을 확인했다.
- 이관 제어면과 검증 도구 10개 파일을 `a2f7e1a`로 선택 커밋하고 `origin/feature/modernization`에 푸시했다.
- resume checker에서 `safeToResume=true`, `crossPcReady=true`를 확인했다.
- `data/*` 35개 파일을 원본 수정 없이 조사했으며 JSON 33개가 모두 parse 가능함을 확인했다.
- JSON root hash `b7dfec6b7cb82c579f1a834434f6286c57e6364cd759b1fbcedc2a25db3f0014`가 기존 기준과 일치했다.
- `main.js`·`Info.js` 경로 선언과 직접 load/save 증거를 결합해 저장소 후보 47개를 분류했다: authoritative 26, reference 8, reconciliation-only 11, excluded 2.
- 저장소 snapshot에 없는 authoritative Android 파일 `petHomeActivityData.json`, `petHomePlacedFurniture.json`을 별도 미확인 대상으로 기록했다.
- 데이터 inventory와 생성기를 `a835270`으로 선택 커밋하고 `origin/feature/modernization`에 푸시했다.
- 푸시 후 resume checker에서 `crossPcReady=true`를 확인했다.
- authoritative 저장소 26개와 현재 DDL/importer를 읽기 전용으로 대조했다.
- 전체 domain import 완료 0개, 부분 domain import 6개, manifest-only 18개, source snapshot 누락 2개로 확인했다.
- importer는 JSON 33개의 checksum은 기록하지만 raw payload와 파일별 record count를 저장하지 않음을 확인했다.
- 사용자 결정 `DEC-064`로 누락 파일 2개의 합성 fixture 개발, 운영 오픈 전 시험 DB 폐기·재생성, 실제 전체 snapshot 최종 이관 원칙을 기록했다.
- 실제 `data/`와 분리된 합성 fixture 2개와 검증기를 생성했다.
- 합성 사용자 1명, 활동·소셜 구조와 장착 가구 2건이 필수 구조를 충족하며 운영 snapshot root hash가 변하지 않음을 확인했다.
- 합성 fixture·검증기·초기화 정책을 `03adf05`로 `origin/feature/modernization`에 푸시했다.
- 운영 snapshot dump 계층을 먼저 만드는 시도는 사용자 확정 순서와 달라 커밋 전에 모두 제거했다.
- 기존 001~027 schema를 26개 authoritative 저장소와 대조하고 출석·커뮤니티·공성전·패키지·펫 탐험·미니펫 컬렉션·시련탑·운영설정 누락 테이블을 `028_complete_legacy_domains.sql`로 설계했다.
- 도메인별 Mermaid ERD와 26개 authoritative 저장소별 목적 테이블 매핑을 `migration-control/schema/HOIBOT_DATABASE_ERD.md`에 기록했다.
- 실제 Docker MariaDB 컨테이너에 운영 DB와 분리된 `hoibot_schema_design` DB를 생성하고 001~028 migration을 적용했다.
- 물리 schema에서 base table 118개, FK 167개, migration 28개와 신규 대표 테이블 7개 존재를 확인했다.
- Docker `information_schema`에서 118개 테이블·817개 컬럼을 읽어 도메인별 전체 물리 컬럼 ERD를 생성했다.
- 운영 PC 재설치에 필요한 image digest, 환경변수 이름, 초기화 순서, 정상 건수, 검증 SQL, migration SHA-256 28건과 최종 운영 이관 준비물을 `schema/db-table-init.md`에 기록했다.
- 실제 사용자·운영 원문이 없는 `functional-v1.sql` 관계형 fixture를 개발 전용 ID와 `synthetic-*` namespace로 작성했다.
- loader가 `hoibot_schema_design`·`hoibot_rehearsal_*`만 허용하고 그 외 DB는 mutation 전에 거부하도록 구현했다.
- 합성 fixture SQL 60문장을 한 transaction으로 적재하고 28개 대표 테이블을 transaction 내부에서 검증했다.
- 첫 적용, 반복 적용, verify-only에서 동일 건수를 확인했으며 `DATABASE_NAME=hoibot` 대상 거부도 확인했다.
- `COMMAND_REGISTRY.md` 1,132개 그룹을 실제 `main.js`·`Info.js` literal과 주변 load/save 문맥으로 재검증하는 command inventory 생성기를 추가했다.
- active command group 837개 중 source literal 820개와 active 미확인 17개를 기록하고, 삭제 체크 literal 75개는 실행 여부 수동 검토 대상으로 분리했다.
- 첫 조회 슬라이스 `/내정보`의 exact guard, legacy helper·read file과 MariaDB repository/service/formatter 경로를 재검증했다.
- 실제 legacy 출력은 상세보기 접힘 구간 U+200B가 686개인데 서버 formatter는 500개임을 확인해 정확히 686개와 동일한 공백 위치로 수정했다.
- 합성 DB의 `synthetic-user-alpha`에 대해 25개 전체 출력 줄과 U+200B 686개 exact contract를 통과했다.
- `/내정보` 슬라이스 증거를 `verified`로 기록하고 repo validator를 통과했다.

## 진행 중인 작업

- 첫 변경 슬라이스 `/서버이동`의 legacy와 현재 `IrisAdminCommandService` 계약을 대조한다.

## 변경 파일

- `개발환경_고도화/migration-control/CHECKPOINT.md`
- `개발환경_고도화/migration-control/progress.json`
- `개발환경_고도화/DECISIONS.md`
- `개발환경_고도화/migration-control/fixtures/missing-operational/README.md`
- `개발환경_고도화/migration-control/fixtures/missing-operational/petHomeActivityData.json`
- `개발환경_고도화/migration-control/fixtures/missing-operational/petHomePlacedFurniture.json`
- `개발환경_고도화/migration-control/scripts/validate-synthetic-missing-data.mjs`
- `개발환경_고도화/runtime/migrations/028_complete_legacy_domains.sql`
- `개발환경_고도화/migration-control/schema/HOIBOT_DATABASE_ERD.md`
- `개발환경_고도화/migration-control/schema/db-table-init.md`
- `개발환경_고도화/runtime/scripts/generate-database-erd.ts`
- `개발환경_고도화/migration-control/fixtures/synthetic-relational/functional-v1.sql`
- `개발환경_고도화/migration-control/fixtures/synthetic-relational/README.md`
- `개발환경_고도화/runtime/scripts/load-synthetic-relational.ts`
- `개발환경_고도화/migration-control/scripts/build-command-inventory.mjs`
- `개발환경_고도화/migration-control/inventory/commands.json`
- `개발환경_고도화/migration-control/evidence/player-profile-read/contract.json`
- `개발환경_고도화/migration-control/evidence/player-profile-read/slice.json`
- `개발환경_고도화/runtime/src/player/legacy-profile-formatter.ts`
- `개발환경_고도화/runtime/scripts/probe-my-profile-synthetic.ts`

기존 캐릭터 MVP와 그 밖의 미커밋 변경은 소유권이 불명확하므로 건드리지 않는다.

## 검증

- 실행 명령: 저장소 체크포인트 열거와 current checkpoint 내용 확인
- 실행 명령: `git status`, HEAD/upstream, remote URL, 체크포인트 추적 여부 확인
- 실행 명령: `node --env-file-if-exists=.env --import tsx scripts/resume-migration.ts`
- 실행 명령: 같은 명령의 `--json` 출력을 JSON 파싱해 `safeToResume` 확인
- 실행 명령: `npm.cmd run typecheck`
- 결과: 충돌하는 다른 체크포인트 없음. TypeScript 검증 통과. 로컬 migration 28개와 DB 적용 migration 28개의 checksum 일치. 제어면 푸시 후 로컬 재개와 다른 PC 재개가 모두 가능. 현재 snapshot 완료 import run 없음.
- 실행 명령: `node 개발환경_고도화/migration-control/scripts/build-data-inventory.mjs`
- 실행 명령: inventory 요약 검증과 `git diff --check -- 개발환경_고도화/migration-control`
- 결과: repository file 35, JSON 33, store 후보 47. invalid JSON 0. root hash 기준값 일치. unknown 분류 0. 저장소에 없는 authoritative 파일 2개 확인. diff check 통과.
- 실행 명령: 푸시 후 `node --env-file-if-exists=.env --import tsx scripts/resume-migration.ts --json`
- 결과: HEAD/upstream `a835270` 일치, 체크포인트·필수 artifact 추적/푸시 확인, `crossPcReady=true`. 다만 로컬 migration 27개와 DB 적용 migration 28개가 불일치해 `safeToResume=false`.
- 실행 명령: `node --check 개발환경_고도화/migration-control/scripts/build-db-coverage.mjs`
- 실행 명령: `node 개발환경_고도화/migration-control/scripts/build-db-coverage.mjs`
- 결과: authoritative 26개 = partial-domain-import 6 + manifest-only 18 + source-snapshot-missing 2. full-domain-import 0. 매핑 대상 table이 현재 DDL에 모두 존재함을 확인. diff check 통과.
- 실행 명령: `node --check 개발환경_고도화/migration-control/scripts/validate-synthetic-missing-data.mjs`
- 실행 명령: `node 개발환경_고도화/migration-control/scripts/validate-synthetic-missing-data.mjs`
- 결과: 합성 fixture JSON 2개 구조 검증 통과. synthetic owner 1명, 장착 가구 2건. 실제 `data/` file count 35, JSON 33, root hash `b7dfec6...0014` 유지.
- 실행 명령: Docker MariaDB에 `hoibot_schema_design` 생성 후 `npm.cmd run db:migrate`
- 결과: 001~028 migration 적용 성공. base table 118개, FK 167개, migration 28개, 신규 대표 테이블 7개 확인. `npm.cmd run typecheck`와 변경 파일 `git diff --check` 통과.
- 실행 명령: `node --env-file-if-exists=.env --import tsx scripts/generate-database-erd.ts` (`DATABASE_NAME=hoibot_schema_design`)
- 결과: 실제 Docker schema 기준 테이블 118개와 컬럼 817개를 컬럼 ERD에 반영. 운영 PC 재설치 문서와 migration checksum manifest 작성.
- 실행 명령: `load-synthetic-relational.ts` dry-run, `--apply` 2회, `--verify-only`
- 결과: fixture checksum `d9ab5aef...e4fd`, SQL 60문장, 대표 테이블 28개 검증 통과. 반복 적용 후 건수 불변. 합성 player 3, currency account 6, guild 2, home 2 등 확인.
- 실행 명령: 동일 loader에 `DATABASE_NAME=hoibot` 지정
- 결과: `Synthetic fixture is blocked for database: hoibot`로 mutation 전 거부 확인.
- 실행 명령: command inventory 생성기 syntax·artifact 요약 검증
- 결과: registry group 1,132, active 837, source literal found 820, active unverified 17, deleted literal review 75, source-only candidate 16.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, `probe-my-profile-synthetic.ts`
- 결과: typecheck 통과, runtime test 92개 통과, `/내정보` 25줄과 U+200B 686개 exact contract 통과.
- 실행 명령: `validate-slice-evidence.mjs .../player-profile-read/slice.json`
- 결과: `valid slice evidence: player-profile-read`.

## 충돌·막힘·미승인 사항

- dirty worktree 때문에 최신 `feature/prod` 병합은 안전하지 않다.
- 로컬 `feature/prod`는 `382e068dd5ac9e09cdb4b92de6529e5f40394388`로 원격보다 뒤에 있다.
- 현재 JSON root hash와 일치하는 완료된 DB import run은 확인되지 않았다.
- 현재 Git snapshot에 authoritative Android 파일 2개가 없어 실제 구조와 checksum을 아직 확정할 수 없다.
- 전체 legacy field를 domain row로 옮기는 저장소는 현재 0개이므로 기존 importer apply는 전체 데이터 시험 이관으로 사용할 수 없다.
- DB에는 현재 작업트리에서 제거된 `028_character_mvp.sql` 적용 이력이 남아 있어 migration checksum 검증이 실패한다. 이 상태에서는 DB apply를 진행하지 않는다.
- `DEC-064`는 로컬 `DECISIONS.md`에 작성했지만 기존 다른 고도화 결정의 미커밋 변경과 겹쳐 아직 선택 커밋하지 않았다. 원격 재개 시에는 푸시된 fixture `README.md`와 이 체크포인트를 적용 기준으로 사용하고, DECISIONS 정리 시 초안을 함께 반영한다.
- 합성 fixture는 개발·시험 전용이며 실제 운영 파일 2개의 확보·검증을 대체하지 않는다.
- 운영 DB apply와 cutover는 승인되지 않았다.
- `DEC-065`는 기존 다른 고도화 결정의 미커밋 변경과 겹치는 로컬 초안이다. 원격 재개 기준은 선택 커밋할 `MASTER_PLAN.md`와 이 체크포인트로 유지한다.

## 다음 행동

1. `/서버이동`의 exact/full-pattern guard, 관리자 권한, member server mutation, save flow와 현재 MariaDB transaction·audit·outbox를 대조한다.

## 보안

- 비밀 값, 평문 자격 증명, KakaoTalk 원문과 불필요한 개인정보를 기록하지 않는다.

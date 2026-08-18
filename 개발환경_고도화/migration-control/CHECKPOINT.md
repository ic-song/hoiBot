# 작업 복구 체크포인트

- 작업 키: `hoibot-rdb-migration`
- 작업 이름: hoiBot 전체 운영 시스템 RDB 이관
- 작업 상태: 진행 중
- 정리 후보: 아니요
- 체크포인트 버전: 31
- 마지막 갱신: 2026-08-13 14:30 KST
- 대화 식별명: 전체 이관 제어면

허용 상태: `진행 중 → 검증 완료 → 작업 완료`

## 현재 목표

- 사용자 요청에 따라 소스 순서 10개 기능 슬라이스의 실제 서버 로직 이관을 연속 진행한다. 현재 1/10 `/펫먹이조합`을 구현한다.

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
- 마지막 확인 푸시 커밋: `dda9b89242ad3ac820d78371df7f9dd2ba890c72` (`/캐슬대전조합` 슬라이스)
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
- 첫 변경 슬라이스 `/서버이동`의 legacy guard, 관리자 권한, 회원 서버 mutation과 save flow를 조사했다.
- legacy 구현은 메모리의 `member.<target>.server`를 변경한 뒤 `saveJsonFile`을 호출하지 않아 재시작 시 변경 유실 가능성이 있음을 증거에 기록했다.
- 합성 관리자 Kakao identity, 비관리자 identity와 두 번째 합성 서버를 fixture에 추가했다.
- 포팅본이 `player.server.assign` 권한을 검사하고, profile update·operation·audit·command execution·internal/Iris outbox를 하나의 transaction으로 저장함을 개발 DB에서 검증했다.
- 같은 event ID 재전송 시 profile version이 한 번만 증가하고 같은 결과를 반환하는 멱등성을 확인했다.
- `/서버이동` 슬라이스 증거를 `verified`로 기록하고 repo validator를 통과했다.
- 체크포인트에 적혀 있던 `/약관동의`, `/약관거부`가 실제 명령이 아님을 확인하고 실제 5개 입력(`/가입`, `시작한다`·`/시작한다`, `거절한다`·`/거절한다`)으로 정정했다.
- legacy `/가입`은 동의 전에 member·pet·title을 저장하고 메모리 `termsState`로 대기하며, 거절해도 생성 데이터를 제거하지 않고 재시작 시 대기 상태가 사라짐을 확인했다.
- 가입 전 `attendanceLight.json`을 표현할 관계형 테이블이 없음을 발견해 `029_pre_signup_attendance.sql`을 추가했다.
- 가입 동의 transaction이 가입 전 출석 횟수·최근 출석일·서버를 새 player counter와 attendance projection으로 옮기고 원본을 `migrated` 처리하도록 구현했다.
- 사이트 Kakao 인증 가입과 Iris 가입이 같은 초기 회원 생성 로직과 출석 이관을 사용하도록 연결했다.
- 실제 개발 schema에 migration 029를 적용하고 migration 29개, table 119개, column 831개, FK 171개를 확인했다.
- 합성 관계형 fixture에 미가입 candidate와 경량 출석을 추가하고 29개 대표 테이블을 두 번 적용·verify-only 검증했다.
- 가입 대기 중 player 미생성, 새 DB client에서도 대기 유지, 동의 초기 행·출석 이관, 거절 시 이름 예약 해제·player 미생성, exact reply와 이벤트 멱등성을 검증했다.
- 가입 슬라이스 evidence를 `verified`로 기록하고 validator를 통과했다.
- legacy `/펫생성`이 `member_pet.json`, `petSkillData.json`, `petHomeData.json`을 순서대로 저장하며 성격·종족·이모지, 90강, 정령왕 피닉스, 십원 스킬, 초보자 미니펫, 스윗홈을 함께 지급함을 확인했다.
- broad prefix guard 대신 공백 없는 1~6자 이름 전체 패턴을 적용해 접미 안내문이 mutation으로 해석되지 않도록 했다.
- 누락된 펫 가입일·성격·강화시각 컬럼과 정령·스킬 가방 관계를 `030_pet_creation_foundations.sql`로 설계했다.
- 실제 개발 schema에 migration 030을 적용하고 migration 30개, table 121개, column 845개, FK 174개를 확인했다.
- 합성 fixture에 펫 성격·가입일, 정령, 스킬 가방을 추가하고 checksum `563802fe...99fb`, SQL 66문장, 대표 테이블 31개를 두 번 적용·verify-only 검증했다.
- `/펫생성` 포팅본이 빈 펫 행 잠금부터 펫·정령·스킬·미니펫·홈·감사·명령 실행·순서 보장 outbox를 한 transaction으로 저장하도록 구현했다.
- 합성 MariaDB probe로 정상 2개 reply, starter 관계, 동일 event 멱등성, 기존 펫 거부를 검증하고 evidence를 `verified`로 기록했다.
- `/펫정보`, `/ㅎ`, `ㅁㅁㅁ`의 exact guard와 legacy pet/home/skill/daily 조회 경로를 재검증했다.
- `031_pet_info_projection.sql`로 펜던트·친밀도·일일 기록·홈뱃지 큐브를 설계하고 Docker MariaDB에 적용했다.
- 실제 물리 schema 31 migrations, 125 tables, 893 columns, 178 FKs와 migration checksum 일치를 확인했다.
- 관계형 fixture를 70문장·35개 대표 테이블로 확장해 두 번 적재와 verify-only에서 동일 건수를 확인했다.
- 합성 MariaDB에서 이미지·본문 2개 reply 순서, 종합매력 2,703, 홈 매력 108, U+200B 500개와 운영 DB 차단을 검증했다.
- 패스 전용 댓글·피드·알림 아이콘을 각각의 완료 상태로 판정하도록 parity 차이를 수정하고 테스트로 고정했다.
- `/펫정보` 슬라이스 증거를 `verified`로 기록했다. 전체 매력·친밀도·탐험 순위 projection은 후속 범위로 남겼다.
- `/펫이름 [이름]`의 legacy broad-prefix guard, 펫·변경권 두 파일 save order와 공성전 무응답 차단을 재검증했다.
- 포팅 guard를 공백 없는 1~6자 단일 인자로 제한하고 펫 이름, 변경권 차감, inventory ledger, operation, execution, audit와 outbox를 한 transaction으로 구현했다.
- 합성 fixture에 `펫 이름변경권🎫` 2개를 추가하고 checksum `ada4f36e...17ac`, SQL 70문장, 대표 테이블 35개를 두 번 적용·verify-only 검증했다.
- 실제 개발 MariaDB probe로 이름 변경, 변경권 2→1, 각 영속 효과 1건, 동일 event 멱등 재실행과 운영 DB 사전 차단을 확인했다.
- `/펫이름` evidence를 `verified`로 기록했다. legacy zero-key 삭제는 MariaDB zero quantity row 유지로 정규화했다.
- `/펫이름조합`의 exact guard, 공성전 무응답 차단, 잡템 10개 우선 검사, 포인트 1억 후순위 검사와 단일 `member.json` save flow를 재검증했다.
- 기존 schema의 inventory·currency account와 양쪽 ledger를 재사용해 별도 migration 없이 조합 service를 구현했다.
- 합성 fixture에 `잡템☠️` 20개 stack을 추가하고 checksum `17dace94...182`, SQL 70문장, 대표 테이블 35개와 inventory stack 5개를 반복 적재·verify-only 검증했다.
- 실제 개발 MariaDB에서 잡템 20→10, 포인트 200,000,000→100,000,000, 변경권 2→3과 inventory ledger 2건·currency ledger 1건·operation/execution/audit/outbox 각 1건을 확인했다.
- 동일 event 재실행이 재차감 없이 저장 결과를 반환하며, 전체 probe를 서로 다른 event로 두 번 실행해 반복 가능성을 확인했다.
- 운영 DB 기본 이름 `hoibot`에서는 연결 mutation 전 probe가 차단되고 운영 snapshot을 읽거나 수정하지 않았음을 확인했다.
- `/펫이름조합` evidence를 `verified`로 기록했다. legacy zero-key 삭제와 전체 `checkRank` 장식은 후속 정규화 위험으로 남겼다.
- `/캐슬대전조합 [수량]`의 인자 생략 기본값 1, 숫자 전용 guard, 수량 0 허용, 양념치킨 6배 차감과 리셋권 지급을 재검증했다.
- legacy 성공 분기에 `saveJsonFile`이 없어 재시작 시 변경이 유실될 수 있음을 이관 위험으로 기록했다.
- 기존 inventory schema와 ledger를 재사용해 두 stack, operation, execution, audit와 outbox를 한 transaction으로 구현했다.
- 합성 fixture에 양념치킨 12개와 캐슬대전리셋권 0개를 추가하고 checksum `a0939819...d8ec`, SQL 70문장, 대표 테이블 35개와 inventory stack 7개를 반복 적재·검증했다.
- 실제 개발 MariaDB에서 수량 2 조합으로 치킨 12→0, 리셋권 0→2, inventory ledger 2건과 operation/execution/audit/outbox 각 1건을 확인했다.
- 동일 event 멱등 재실행과 독립 event 전체 probe 2회를 통과하고 운영 DB 기본 이름은 mutation 전에 차단했다.
- `/캐슬대전조합` evidence를 `verified`로 기록했다. 입력 폭주 방지를 위해 1회 최대 수량 1,000,000 제한을 추가했다.
- `/레이드인장조합 [수량]`의 인자 생략 기본값 1, 숫자 0의 최소 수량 1 처리, 잡템 우선·포인트 후순위 검사와 exact reply를 재검증했다.
- legacy 성공 분기에 `saveJsonFile`이 없어 재시작 시 변경 유실 가능성이 있음을 기록했다.
- 기존 inventory·currency schema와 양쪽 ledger를 재사용해 잡템·포인트 차감, 인장 지급, operation/execution/audit/outbox를 한 transaction으로 구현했다.
- 합성 fixture에 레이드 인장 0개 stack을 추가하고 checksum `2d0a26ba...a778`, SQL 70문장, 대표 테이블 35개와 inventory stack 8개를 반복 적재·검증했다.
- 실제 개발 MariaDB에서 수량 2 기준 잡템 2,000→0, 포인트 30억→10억, 인장 0→2와 inventory ledger 2건·currency ledger 1건·operation/execution/audit/outbox 각 1건을 확인했다.
- 동일 event 멱등 재실행과 독립 event 전체 probe 2회를 통과하고 운영 DB 기본 이름은 mutation 전에 차단했다.
- `/레이드인장조합` evidence를 `verified`로 기록했다. 1회 최대 수량 1,000,000과 미완성 전체 rank 장식은 위험에 명시했다.

## 진행 중인 작업

- 10단계 범위: `/펫먹이조합`, `/랜덤조합`, `/부띠끄조합`, `/컬렉션창조오픈`, `/로열오픈`, `/창세오픈`, `/컬렉션창세오픈`, `/미니펫창조조합`, `/이랏싸이마쎄`, `/미니펫창세조합`.
- 현재 1/10 `/펫먹이조합`의 guard, 잡템·포인트 차감, 먹이상자 지급과 transaction을 이관한다.
- WBS `CMD-06-0115`, 작업자 `A`, `feature/modernization`의 기존 구현 중 작업을 재개했다.
- 서비스 본체를 복구하고 Iris dispatch, 합성 먹이상자 stack, 단위 테스트, MariaDB probe와 evidence를 연결했다.

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
- `개발환경_고도화/migration-control/evidence/player-server-change/slice.json`
- `개발환경_고도화/runtime/scripts/probe-player-server-change-synthetic.ts`
- `개발환경_고도화/runtime/migrations/029_pre_signup_attendance.sql`
- `개발환경_고도화/runtime/src/signup/create-initial-player.ts`
- `개발환경_고도화/runtime/src/signup/signup-service.ts`
- `개발환경_고도화/runtime/src/user-auth/provider-verification-service.ts`
- `개발환경_고도화/runtime/test/signup.test.ts`
- `개발환경_고도화/runtime/scripts/probe-signup-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/player-signup/slice.json`
- `개발환경_고도화/runtime/migrations/030_pet_creation_foundations.sql`
- `개발환경_고도화/runtime/src/pet/pet-creation-policy.ts`
- `개발환경_고도화/runtime/src/pet/pet-creation-service.ts`
- `개발환경_고도화/runtime/test/pet-creation.test.ts`
- `개발환경_고도화/runtime/scripts/probe-pet-creation-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/pet-creation/slice.json`
- `개발환경_고도화/runtime/migrations/031_pet_info_projection.sql`
- `개발환경_고도화/runtime/src/pet/pet-info.ts`
- `개발환경_고도화/runtime/src/pet/pet-info-service.ts`
- `개발환경_고도화/runtime/src/pet/maria-pet-info-repository.ts`
- `개발환경_고도화/runtime/test/pet-info.test.ts`
- `개발환경_고도화/runtime/scripts/probe-pet-info-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/pet-info/slice.json`
- `개발환경_고도화/runtime/src/pet/pet-rename-service.ts`
- `개발환경_고도화/runtime/test/pet-rename.test.ts`
- `개발환경_고도화/runtime/scripts/probe-pet-rename-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/pet-rename/slice.json`
- `개발환경_고도화/runtime/src/pet/pet-rename-ticket-craft-service.ts`
- `개발환경_고도화/runtime/test/pet-rename-ticket-craft.test.ts`
- `개발환경_고도화/runtime/scripts/probe-pet-rename-ticket-craft-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/pet-rename-ticket-craft/slice.json`
- `개발환경_고도화/runtime/src/castle/castle-battle-reset-craft-service.ts`
- `개발환경_고도화/runtime/test/castle-battle-reset-craft.test.ts`
- `개발환경_고도화/runtime/scripts/probe-castle-battle-reset-craft-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/castle-battle-reset-craft/slice.json`
- `개발환경_고도화/runtime/src/raid/raid-strike-seal-craft-service.ts`
- `개발환경_고도화/runtime/test/raid-strike-seal-craft.test.ts`
- `개발환경_고도화/runtime/scripts/probe-raid-strike-seal-craft-synthetic.ts`
- `개발환경_고도화/migration-control/evidence/raid-strike-seal-craft/slice.json`
- `COMMAND_INDEX.md`

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
- 실행 명령: 운영 DB 기본 설정으로 합성 fixture loader와 `/서버이동` probe 실행
- 결과: 두 실행 모두 `Synthetic ... is blocked for database: hoibot`로 mutation 전에 차단됨.
- 실행 명령: `DATABASE_NAME=hoibot_schema_design`을 명시해 fixture 재적재와 `probe-player-server-change-synthetic.ts` 실행
- 결과: 비관리자 403, 잘못된 서버 접미사 422, 정상 변경, exact 성공 reply, profile version 2, 동일 event 멱등 재실행, audit 1, command execution 1, outbox 2 검증 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, `validate-slice-evidence.mjs .../player-server-change/slice.json`
- 결과: typecheck 통과, runtime test 92개 통과, `valid slice evidence: player-server-change`.
- 실행 명령: 운영 DB 기본 설정으로 `probe-signup-synthetic.ts` 실행
- 결과: `Synthetic signup probe is blocked for database: hoibot`로 mutation 전에 차단됨.
- 실행 명령: `npm.cmd run db:migrate` (`DATABASE_NAME=hoibot_schema_design`)
- 결과: `029_pre_signup_attendance.sql` 적용, migration 29개 확인. 물리 schema는 table 119개, column 831개, FK 171개.
- 실행 명령: 합성 fixture `--apply` 2회와 `--verify-only`
- 결과: checksum `16570400...a352`, SQL 64문장, 대표 테이블 29개와 `pre_signup_attendance` 반복 적용 검증 통과.
- 실행 명령: `probe-signup-synthetic.ts` (`DATABASE_NAME=hoibot_schema_design`)
- 결과: exact guard·약관·환영·거절 문구, durable pending, 동의 초기 행, 가입 전 출석 3회·서버 이관, 거절 player 미생성, operation/audit/execution/outbox와 멱등성 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, `node --check main.js`, `node --check Info.js`, signup evidence validator
- 결과: TypeScript 통과, runtime test 93개 통과, Rhino 파일 syntax 통과, `valid slice evidence: player-signup`.
- 실행 명령: 운영 DB 기본 설정으로 `probe-pet-creation-synthetic.ts` 실행
- 결과: `Synthetic pet-creation probe is blocked for database: hoibot`로 mutation 전에 차단됨.
- 실행 명령: `npm.cmd run db:migrate` (`DATABASE_NAME=hoibot_schema_design`)
- 결과: `030_pet_creation_foundations.sql` 적용, migration 30개 확인. 물리 schema는 table 121개, column 845개, FK 174개.
- 실행 명령: 합성 fixture dry-run, `--apply` 2회, `--verify-only`
- 결과: checksum `563802fe...99fb`, SQL 66문장, 대표 테이블 31개 반복 적용 검증 통과.
- 실행 명령: `probe-pet-creation-synthetic.ts` (`DATABASE_NAME=hoibot_schema_design`)
- 결과: full guard, 펫 초기값, 정령·스킬·미니펫·홈 관계, 정상 reply 2개, operation/execution/audit 1개와 outbox 2개, 동일 event replay, 기존 펫 거부 검증 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`
- 결과: TypeScript 통과, runtime test 97개 통과.
- 실행 명령: `031_pet_info_projection.sql` 적용과 `information_schema` 물리 건수 확인
- 결과: migration 31개, table 125개, column 893개, FK 178개. migration SHA-256 `c2a41f9c...2e52` 확인.
- 실행 명령: 관계형 fixture dry-run, `--apply` 2회, `--verify-only`
- 결과: checksum `a4eb2df1...450`, SQL 70문장, 대표 테이블 35개 반복 적재·검증 통과.
- 실행 명령: 운영 DB 기본 설정과 `DATABASE_NAME=hoibot_schema_design` 각각으로 `probe-pet-info-synthetic.ts`
- 결과: 운영 DB는 mutation 전에 차단. 개발 DB는 reply 2개, 종합매력 2,703, U+200B 500개와 `operationalSnapshotTouched=false` 검증 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, `node --check main.js`, `node --check Info.js`, pet-info evidence validator
- 결과: TypeScript 통과, runtime test 101개 통과, Rhino 파일 syntax 통과, `valid slice evidence: pet-info`.
- 실행 명령: 관계형 fixture dry-run, `--apply` 2회, `--verify-only`
- 결과: checksum `ada4f36e...17ac`, SQL 70문장, 대표 테이블 35개와 inventory stack 4개 반복 적재·검증 통과.
- 실행 명령: 운영 DB 기본 설정과 `DATABASE_NAME=hoibot_schema_design` 각각으로 `probe-pet-rename-synthetic.ts`
- 결과: 운영 DB는 mutation 전에 차단. 개발 DB는 펫 이름 변경, 변경권 2→1, ledger/operation/execution/audit/outbox 각 1건과 동일 event 멱등성 통과.
- 실행 명령: pet rename probe 2회 연속 실행, `npm.cmd run typecheck`, `npm.cmd test`, Rhino syntax, pet-rename evidence validator
- 결과: 반복 probe가 event별 동일 결과를 반환. TypeScript 통과, runtime test 105개 통과, Rhino 파일 syntax 통과, `valid slice evidence: pet-rename`.
- 실행 명령: 관계형 fixture dry-run, `--apply` 2회, `--verify-only`
- 결과: checksum `17dace94...182`, SQL 70문장, 대표 테이블 35개와 inventory stack 5개 반복 적재·검증 통과.
- 실행 명령: 운영 DB 기본 설정과 `DATABASE_NAME=hoibot_schema_design` 각각으로 `probe-pet-rename-ticket-craft-synthetic.ts`
- 결과: 운영 DB는 mutation 전에 차단. 개발 DB는 잡템 20→10, 포인트 200,000,000→100,000,000, 변경권 2→3, 원장·operation/execution/audit/outbox 건수와 동일 event 멱등성을 통과했으며 전체 probe 2회도 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, Rhino syntax, pet-rename-ticket-craft evidence validator, resume checker
- 결과: TypeScript 통과, runtime test 109개 통과, Rhino 파일 syntax 통과, `valid slice evidence: pet-rename-ticket-craft`, `safeToResume=true`, `crossPcReady=true`.
- 실행 명령: 관계형 fixture dry-run, `--apply` 2회, `--verify-only`
- 결과: checksum `a0939819...d8ec`, SQL 70문장, 대표 테이블 35개와 inventory stack 7개 반복 적재·검증 통과.
- 실행 명령: 운영 DB 기본 설정과 `DATABASE_NAME=hoibot_schema_design` 각각으로 `probe-castle-battle-reset-craft-synthetic.ts`
- 결과: 운영 DB는 mutation 전에 차단. 개발 DB는 치킨 12→0, 리셋권 0→2, inventory ledger 2건과 operation/execution/audit/outbox 각 1건, 동일 event 멱등성 및 전체 probe 2회를 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, Rhino syntax, castle-battle-reset-craft evidence validator
- 결과: TypeScript 통과, runtime test 113개 통과, Rhino 파일 syntax 통과, `valid slice evidence: castle-battle-reset-craft`.
- 실행 명령: 관계형 fixture dry-run, `--apply` 2회, `--verify-only`
- 결과: checksum `2d0a26ba...a778`, SQL 70문장, 대표 테이블 35개와 inventory stack 8개 반복 적재·검증 통과.
- 실행 명령: 운영 DB 기본 설정과 `DATABASE_NAME=hoibot_schema_design` 각각으로 `probe-raid-strike-seal-craft-synthetic.ts`
- 결과: 운영 DB는 mutation 전에 차단. 개발 DB는 잡템 2,000→0, 포인트 30억→10억, 인장 0→2, 양쪽 원장과 operation/execution/audit/outbox 각 1건, 동일 event 멱등성 및 전체 probe 2회를 통과.
- 실행 명령: `npm.cmd run typecheck`, `npm.cmd test`, Rhino syntax, raid-strike-seal-craft evidence validator
- 결과: TypeScript 통과, runtime test 118개 통과, Rhino 파일 syntax 통과, `valid slice evidence: raid-strike-seal-craft`.

## 충돌·막힘·미승인 사항

- dirty worktree 때문에 최신 `feature/prod` 병합은 안전하지 않다.
- 로컬 `feature/prod`는 `382e068dd5ac9e09cdb4b92de6529e5f40394388`로 원격보다 뒤에 있다.
- 현재 JSON root hash와 일치하는 완료된 DB import run은 확인되지 않았다.
- 현재 Git snapshot에 authoritative Android 파일 2개가 없어 실제 구조와 checksum을 아직 확정할 수 없다.
- 전체 legacy field를 domain row로 옮기는 저장소는 현재 0개이므로 기존 importer apply는 전체 데이터 시험 이관으로 사용할 수 없다.
- `DEC-064`는 로컬 `DECISIONS.md`에 작성했지만 기존 다른 고도화 결정의 미커밋 변경과 겹쳐 아직 선택 커밋하지 않았다. 원격 재개 시에는 푸시된 fixture `README.md`와 이 체크포인트를 적용 기준으로 사용하고, DECISIONS 정리 시 초안을 함께 반영한다.
- 합성 fixture는 개발·시험 전용이며 실제 운영 파일 2개의 확보·검증을 대체하지 않는다.
- 운영 DB apply와 cutover는 승인되지 않았다.
- `DEC-065`는 기존 다른 고도화 결정의 미커밋 변경과 겹치는 로컬 초안이다. 원격 재개 기준은 선택 커밋할 `MASTER_PLAN.md`와 이 체크포인트로 유지한다.

## 다음 행동

1. `/펫먹이조합` typecheck·단위 테스트와 합성 MariaDB fixture·probe·parity를 실행한다.

## 보안

- 비밀 값, 평문 자격 증명, KakaoTalk 원문과 불필요한 개인정보를 기록하지 않는다.

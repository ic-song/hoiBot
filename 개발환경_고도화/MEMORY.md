# hoiBot 고도화 대화 메모리

최종 갱신일: 2026-08-04

이 문서는 새 대화 세션이 현재 작업을 이어받기 위한 최신 상태 스냅샷이다.
대화 전문이나 세션별 누적 로그를 저장하지 않고, 실행에 필요한 현재 맥락만 유지한다.
확정 결정은 `DECISIONS.md`를 따르며 이 문서에서 다시 결정하지 않는다.

## 현재 목표

- Iris를 hoiBot의 KakaoTalk 입출력 계층으로 사용해 고도화한다.
- PC/redroid 환경에서 KakaoTalk + Iris 연결 상태를 단계적으로 검증한다.
- TypeScript/Node.js 24 LTS/Fastify 5 기반 hoiBot Server로 기존 게임 로직을 점진적으로 이전한다.
- hoiBot Server 전용 게임·운영 데이터 저장소는 MariaDB를 사용한다.
- 기존 JavaScript + JSON 기반 hoiBot 기능과 데이터를 서버로 점진적으로 이전한다.
- 별도 관리 홈페이지에서 서버 API를 통해 게임·운영 데이터를 안전하게 조회·변경할 수 있도록 한다.
- Discord와 기타 외부 API는 서버의 독립된 adapter를 통해 연동한다.
- MariaDB는 기존 JSON 파일을 그대로 복제하지 않고 실제 데이터와 저장 흐름을 기준으로 도메인별 관계형 모델로 설계한다.
- 코드 하드코딩 값은 공통코드, 전용 도메인 카탈로그, 버전형 운영 설정, 환경설정, 코드 불변 규칙으로 분류해 이전한다.
- 집 PC에서 검증한 환경을 운영 PC에 동일하게 재현할 수 있도록 구성·마이그레이션·검증 절차를 저장소에서 관리한다.
- 구현은 수직 기능 단위로 진행하지만 운영은 별도 테스트 환경에서 전체 기능을 완성·검증한 뒤 기존 Rhino를 중단하고 Iris 서버로 일괄 전환한다.
- mutation 활성화 전에는 Rhino/JSON 복귀가 가능하며 활성화 후에는 MariaDB backup/point-in-time 또는 이전 서버 이미지로만 롤백한다.
- 서버 본구현 전에 redroid/KakaoTalk/Iris에서 테스트 명령의 서버 왕복과 이벤트 전송 범위를 실제로 확인한다.

## 현재 진행 위치

- PC/redroid 구성과 기준 영상이 확정됐다.
- hoiBot Server 구현 스택이 확정됐다.
- `개발환경_고도화/runtime/`에 Fastify 기반 Lite 서버와 Iris HTTP 이벤트 수신 API가 존재한다.
- 고도화 문서는 결정, 대화 메모리, 정보성 참조자료로 분리됐다.
- 최신 `feature/prod`의 `4f00533`에서 `feature/modernization` 브랜치를 생성했다.
- 고도화 전용 작업공간은 `C:\Users\user\Desktop\hoiBot_modernization`이다.
- 1단계 redroid/KakaoTalk/Iris → hoiBot Lite Server 연결 및 `/ping` 감지 검증을 완료했다.
- 실제 redroid DB와 Iris 원본 코드를 기준으로 이벤트 감지 가능 범위를 `references/IRIS_EVENT_CAPABILITY_MATRIX.md`에 정리했다.
- Iris가 다른 방에서 감지한 모든 단일 이미지를 `/ping` 테스트방으로 전달하는 Lite Server 기능을 구현하고 로컬 검증을 통과했다.
- Docker MariaDB, 서버 연결 풀, 초기 마이그레이션과 DB 기반 readiness 구현·실검증을 완료했다.
- `001`~`011` MariaDB 마이그레이션으로 event processing, identity/import, common code/config, `/내정보` read model, 관리자 인증·Kakao identity 연결, 후속 도메인 기반 테이블을 구현했다.
- 서버를 Adapter/Service/Repository/transaction 경계로 분리하고 Iris 중복 방지·operation/audit/outbox·재시도 worker를 연결했다.
- ProfileView, 기존 `/내정보` 형식 formatter, 관리자 회원 조회와 낙관적 잠금 `/서버이동` Service/API를 구현했다.
- Argon2id 관리자 계정, DB hash 세션, RBAC, CSRF와 identity 승인·게임 서버·감사 API를 구현했다.
- React + Vite 관리자 SPA의 로그인, 회원 검색, 서버 변경, identity 승인, 감사 조회 기반을 추가했다.
- 원본 33개 JSON을 lossless/checksum 방식으로 읽는 기본 dry-run importer를 구현했다. 실제 데이터 apply는 하지 않았다.

## 확인된 현상

- 사용자가 redroid 환경이 현재 실행 중이라고 확인했다.
- 저장소의 Lite 서버에는 health, ready, ping, version 및 Iris 이벤트 수신 기반이 구현돼 있다.
- redroid의 KakaoTalk과 Iris가 실행 중이며 Iris HTTP `3000` 포트가 정상 응답한다.
- Iris가 hoiBot Lite Server `3100` 포트로 실제 KakaoTalk 이벤트를 전달한다.
- 최근 이벤트 창에서 서로 다른 `/ping` 이벤트 16건을 감지해 요청 기준 10건을 충족했다.
- 정확한 `/ping` 이벤트의 `chat_id`를 이용한 Iris `/reply` `pong` 전송이 성공했다.
- 앞으로 `/ping` 반복 검증은 서로 다른 이벤트 10건까지만 집계하고 즉시 종료한다.
- 정확한 `/ping` 입력에 hoiBot Server가 Iris `/reply`를 사용해 `발신자이름 pong`으로 자동 응답하도록 구현했다.
- 실제 KakaoTalk `/ping` 입력과 `발신자이름 pong` 출력이 서버 이벤트에서 연속 관측됐고 응답 이벤트의 `isMine=true`를 확인했다.
- 2026-08-04 카카오톡 앱 데이터 초기화와 새 계정 로그인 후 기존 Iris DB 감시가 멈췄으나 Iris 프로세스 재시작으로 복구했고, 새 `/ping` 수신 후 약 0.66초 뒤 `pong` 응답 이벤트를 확인했다.
- 카카오톡 계정 변경 직후 Iris의 `/data/local/tmp/names.db` 이름 캐시에 이전 계정 기준 표시명이 남아 동일 사용자 ID가 잘못된 이름으로 전달된 사례를 확인했다. 이후 알림 기반 이름 캐시가 갱신되자 실제 표시명으로 복구됐다.
- hoiBot Server를 Windows 작업 스케줄러 `hoiBot Modernization Server`로 전환했다. 현재 사용자 로그인 시 자동 시작하고 비정상 종료 시 1분 간격으로 최대 999회 재시작하며, 전환 후 새 프로세스의 서버·MariaDB readiness가 모두 `ready`임을 확인했다.
- 자동 테스트 15건, 타입 검사와 빌드는 통과했다.
- Node.js 프로젝트를 저장소 최상위 `runtime/`에서 `개발환경_고도화/runtime/`으로 이동했다.
- 이동 후 새 경로에서 Lite 서버를 재기동했으며 `0.0.0.0:3100` readiness 확인을 통과했다.
- Iris는 `chat_logs`의 새 행을 HTTP/WebSocket으로 전달하며 공식 고수준 분류는 `message`, `new_member`, `del_member`, `unknown`이다.
- 현재 redroid 이력에서 `NEWMEM`, `DELMEM`, `SYNCMODMSG`, `SYNCDLMSG`, `SYNCREWR` 원시 origin을 확인했다.
- 답글은 `type=26`과 source attachment 필드로 감지 가능하고, 수정·삭제는 각각 `SYNCMODMSG`, `SYNCDLMSG`를 서버가 직접 정규화해야 한다.
- 현재 서버에서 상대가 보낸 일반 답글을 `type=26`, `isMine=false`, `src_isThread=false`와 source 연결 필드로 실관측했다.
- 봇을 실제 `@멘션`한 메시지를 `type=1`, `origin=MSG`, `attachment.mentions[]`의 위치·길이·사용자 ID 메타데이터와 `bot_command` 구조로 실관측했다.
- 단일 이미지를 `type=2`, `origin=MSG`, `isMine=false`로 실관측했고 `attachment.url`, 썸네일 URL, 크기와 이미지 규격 메타데이터를 확인했다.
- 이미지 본문은 이벤트에 포함되지 않고 Kakao CDN URL로 제공되며, 해당 URL의 GET 요청에서 `image/png` 본문 수신을 확인했다.
- 단일 이미지 전달은 원본 방과 테스트방의 분리, Kakao CDN HTTPS, 용량·시간 제한을 적용하고 다중 이미지는 제외한다.
- 최근 수신 이미지 2건을 테스트방으로 재전송했고, KakaoTalk DB에서 같은 대상 방에 생성된 발신 이미지 2건을 확인했다.
- 모든 단일 이미지 전달 버전으로 서버를 재기동한 뒤 원본 방과 테스트방에서 이미지 이벤트가 1건씩 감지돼 자동 전달 왕복을 확인했다.
- 사용자 요청으로 이미지 자동 전송을 OFF했다. 이미지 감지는 유지하며 대상 방 설정 없이 서버를 재기동했다.
- 서버 PC의 Node.js 런타임에서 Iris `/query`를 통한 redroid KakaoTalk DB 읽기 연결을 확인했다.
- KakaoTalk DB의 3개 연결 스키마와 테이블 구조·행 개수를 개인정보 없이 탐색해 `references/KAKAOTALK_DB_SCHEMA_INVENTORY.md`에 기록했다.
- redroid KakaoTalk DB와 별개인 hoiBot Server 전용 DB로 MariaDB를 사용하기로 확정했다.
- 기존 JSON 저장 흐름을 읽기 전용으로 조사해 주요 저장 대상과 다중 파일 갱신 위험을 확인했다.
- 재현 가능한 환경 구성은 `references/REPRODUCIBLE_ENVIRONMENT_BLUEPRINT.md`, MariaDB 신규 구축·이전 순서는 `references/MARIADB_IMPLEMENTATION_BLUEPRINT.md`에 정리했다.
- 공식 MariaDB `11.8.8` 컨테이너를 loopback `3307` 포트와 named volume으로 기동하고 공식 Node Connector `3.5.3`을 연결했다.
- `001_foundation.sql` 마이그레이션으로 migration/probe/event inbox/사용자/방/멤버십 기반 테이블을 생성했다.
- 실제 `SELECT 1`, 트랜잭션 롤백, 마이그레이션 재실행, DB 중단 시 readiness `503`, 재기동 후 readiness 복구와 테스트 행 영속·삭제를 검증했다.
- MariaDB 연결 검증 상세는 `references/MARIADB_CONNECTIVITY_VALIDATION.md`에 기록했다.
- 이벤트 검증 근거는 `references/IRIS_EVENT_CAPABILITY_MATRIX.md`, 서버 구현용 필드·이벤트 매핑은 `references/IRIS_SERVER_EVENT_MAPPING.json`으로 분리했다.
- 2026-08-04 계정 전환 후 현재 KakaoTalk DB를 읽기 전용으로 재집계하고 `chat_logs` 16개 컬럼의 의미·문자열 ID 처리·중첩 JSON 파싱·타입/origin/방향·attachment 필드명을 `KAKAOTALK_DB_SCHEMA_INVENTORY.md`에 현행화했다.
- 같은 검증 기준으로 이벤트 상태와 현재/이전 계정 증거를 `IRIS_EVENT_CAPABILITY_MATRIX.md`에 분리하고 서버 정규화 계약 `IRIS_SERVER_EVENT_MAPPING.json`을 schema version 2로 갱신했다.
- 기존 JSON 스냅샷과 `main.js`/`Info.js`의 저장 흐름을 읽기 전용으로 조사하고 확장형 논리 스키마와 전체 소스 매핑을 `references/LEGACY_JSON_RDB_SCHEMA_DESIGN.md`에 작성했다.
- `main.js`의 상수와 `GLOBAL_CONFIG`를 1차 조사해 공통코드·도메인 카탈로그·버전형 운영 설정의 분리 원칙과 후보를 같은 설계 문서에 반영했다.
- importer dry-run에서 JSON 33개, 회원 610명, 명시적 alias 충돌 1건을 확인했으며 원본 checksum은 반복 실행에서 동일했다.
- 실제 MariaDB에서 duplicate Iris event가 command/outbox를 1회만 생성하고, 서버 변경 idempotency·version 충돌·audit/outbox 트랜잭션이 동작함을 synthetic probe로 검증했다.
- 실제 MariaDB에서 Argon2id 로그인, session hash, CSRF 거부, logout/revoke와 5회 실패 잠금을 검증했다.
- migration 12개 재실행, DB rollback probe, backup을 disposable DB에 복원한 migration count 검증을 완료했다.
- disposable MariaDB에서 33개 JSON을 처음부터 import해 프로필 610, 펫 610, 타이틀 3,086, 홈 610, 길드 회원 155, 랭킹 entry 1,040, 고아 프로필 0건을 확인했다. 610개 legacy nickname identity는 모두 미승인 상태로 유지했다.
- 기존 `checkRank`의 특별 배지 우선순위와 길드 순위 접미사를 안정적인 badge code와 분리된 표시값으로 import한다.
- 서버 Docker image `hoibot-server:local` 빌드와 Compose 설정 검증, 관리자 SPA typecheck/build를 완료했다.

## 미검증 항목

- 다른 참여자 `@멘션`의 동일 구조 여부와 자진 퇴장/강퇴 구분 방식
- 닉네임 변경·반응 이벤트를 위한 별도 테이블 감시 필요성
- Iris WebSocket `/ws` 수신
- redroid 재시작 후 데이터와 설정 유지
- 카카오톡 계정 전환 시 Iris 이름 캐시를 안전하게 초기화·재구축하는 절차

## 열린 질문

- Discord에서 최초로 제공할 기능과 읽기·쓰기 허용 범위
- 저장소에 없는 runtime 홈 활동·배치 가구 파일의 실제 구조
- 실제 Rhino 출력 표본을 이용한 `/내정보` 전체 golden parity. mini-pet 상세와 `checkRank` 변환 자체는 이식했지만 운영 출력과의 문자 단위 비교는 아직 필요하다.
- 운영 전환 전 허용할 read-only smoke 시간과 최종 maintenance window

## 다음 작업

1. 별도 테스트 계정의 실제 Rhino `/내정보` 출력과 신규 formatter를 문자 단위로 비교해 golden parity를 확정한다.
2. display-name 후보를 관리자 화면에서 승인해 Kakao identity 연결 흐름을 별도 테스트 계정으로 end-to-end 검증한다.
3. 구현된 관리자 `/서버이동` API와 Iris 명령의 동일 Service 호출을 승인된 실제 관리자 Kakao identity로 end-to-end 검증한다.
4. currency ledger → inventory → pet/skill/title → guild → home/social → event/ranking → market 순서로 각 수직 기능의 Service/Repository를 구현한다.
5. 다른 참여자 이벤트, WebSocket, 다중 이미지/파일/반응 등 기존 미검증 Iris 입력을 별도 테스트방에서 계속 검증한다.
6. Windows Docker 검증 결과를 Ubuntu Docker 환경에서도 동일 image digest·migration·backup/restore 절차로 재현한다.
7. 전체 기능과 운영 snapshot reconciliation을 통과한 뒤 최종 일괄 전환 점검표를 실행한다.

## 최근 대화 요약

- 고도화 방향을 YouTube 기준의 PC + redroid 환경으로 확정했다.
- 선택되지 않은 다른 실행환경 기술스택은 문서에서 제거했다.
- hoiBot Server 구현 스택을 TypeScript + Node.js 24 LTS + Fastify 5로 확정했다.
- 대화 메모리와 확정 결정 문서를 분리하기로 했다.
- 고도화 작업을 별도 `feature/modernization` 브랜치에서 진행하기로 했다.
- hoiBot을 Iris 기반으로 고도화하기로 확정했다.
- 전환 우선순위를 `ASAP`으로 확정했다.
- 서버 본구현 전에 redroid/KakaoTalk/Iris의 연결·왕복을 먼저 검증하고, 메시지 외 이벤트와 부가 데이터의 전송 범위를 확인하기로 했다.
- 실제 연동 검증 결과를 기준으로 hoiBot Server 구현을 진행하기로 했다.
- `/ping`을 서로 다른 이벤트 10건 이상 감지할 때까지 확인해 달라는 요청에 따라 16건 감지를 확인했다.
- 이후 `/ping` 검증은 10건을 상한으로 제한하기로 확정했다.
- 정확한 `/ping` 입력은 서버 연결 확인 명령으로 사용하고 `발신자이름 pong`으로 답하기로 확정했다.
- 고도화용 Node.js 프로젝트를 `개발환경_고도화/runtime/` 내부에서만 관리하기로 확정했다.
- hoiBot Server 전용 데이터베이스로 MariaDB를 사용하기로 확정했다.
- 기존 JavaScript + JSON 기반 기능을 서버로 점진적으로 이전하고, 별도 관리 홈페이지와 Discord·외부 API가 서버 API를 통해 같은 데이터와 기능을 사용하도록 확정했다.
- 현재 JSON과 저장 흐름을 기준으로 하되 파일별 복제가 아닌 확장 가능한 도메인별 MariaDB 모델을 사용하기로 확정했다.

## 갱신 규칙

1. 의미 있는 고도화 세션 종료 시 이 문서를 최신 상태로 갱신한다.
2. 완료된 항목은 미검증 목록에서 제거하고 확인된 현상 또는 진행 위치에 반영한다.
3. 오래된 진행 맥락과 다음 작업은 현재 상태로 교체하며 세션별로 누적하지 않는다.
4. 사용자 결정이 필요한 내용은 열린 질문에 두고 `DECISIONS.md`에 먼저 기록하지 않는다.
5. 토큰, 카카오톡 원문, 계정정보, 개인정보는 기록하지 않는다.

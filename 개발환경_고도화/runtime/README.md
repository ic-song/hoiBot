# hoiBot Server modernization runtime

Iris 입출력과 MariaDB 도메인 이전을 검증하는 TypeScript/Fastify 서버입니다. 기존 MessengerBot R의 `main.js`, `Info.js`, Android JSON 원본은 변경하지 않습니다.

## 포함 범위

- 모든 요청에 UUID 기반 `requestId` 발급 및 `x-request-id` 응답 헤더 제공
- Iris 원본 payload 구조화 로그 및 개발용 최근 이벤트 메모리 조회
- 기본 1MiB 요청 크기 제한
- Bearer, `x-iris-token`, Iris endpoint 쿼리 토큰 인증
- health, ready, ping, version API
- 정확한 `/ping` 이벤트에 카카오톡 DB 닉네임 우선, Iris sender fallback으로 `이름 pong`을 답하는 연결 확인 명령
- 비운영 환경의 정확한 `/info`에서 Iris 원문·정규화 결과와 관련 KakaoTalk DB 행을 분할 출력하는 진단 명령
- MariaDB 연결 풀, DB 기반 readiness, 버전 관리 마이그레이션과 롤백·재시작 probe
- 파라미터 SQL Repository와 `withTransaction()` 트랜잭션 계약
- Iris event inbox, 명령 중복 방지, operation/audit/outbox와 background 재시도
- `/내정보` ProfileView/legacy formatter와 승인된 Kakao identity 기반 조회
- `/가입` 대기 상태 영속화와 `/시작한다` 동의 시 회원·프로필·초기 펫·재화·카운터·identity 원자 생성
- `/거절한다` 가입 취소, 닉네임 예약 해제와 가입 이벤트 재시도·중복 생성 방지
- 사이트 회원가입, 24시간 미인증 계정, 30분 1회용 코드와 정확한 KakaoTalk `/인증 CODE` 연결
- 일반 사용자 Argon2id 로그인, hash 세션과 CSRF 검증(CAPTCHA는 현재 범위에서 제외)
- 관리자 Argon2id 로그인, RBAC, hash 세션, CSRF, 회원 조회·서버 변경·identity 승인·감사 API
- 공통 transactional operation runner와 재화·인벤토리·펫/스킬/타이틀·길드·홈·이벤트/랭킹·거래소 Application Service
- 모든 도메인 mutation의 idempotency, optimistic version, audit, ledger, internal outbox 처리
- 원본을 쓰지 않는 33개 JSON checksum/lossless dry-run importer
- 정상 종료 처리와 가짜 Iris 이벤트 전송 스크립트

실제 운영 JSON import와 운영 전환은 아직 수행하지 않았습니다. `/내정보` 전체 snapshot parity와 나머지 도메인 Service 구현도 후속 검증 대상입니다.

## 이벤트 매핑 기준

Iris 이벤트 정규화 계층을 구현할 때는 `../references/IRIS_SERVER_EVENT_MAPPING.json`을 서버 필드·이벤트 매핑 기준으로 사용합니다. 실제 검증 상태와 미검증 제약은 `../references/IRIS_EVENT_CAPABILITY_MATRIX.md`에서 먼저 확인합니다.

`unverified`와 `not_direct` 항목은 검증 없이 운영 동작으로 구현하지 않습니다.

## 설치 및 실행

PowerShell 실행 정책과 무관하게 `npm.cmd`를 사용합니다.

```powershell
cd C:\Users\user\Desktop\hoiBot_modernization\개발환경_고도화\runtime
Copy-Item .env.example .env
# .env의 IRIS_SHARED_TOKEN을 16자 이상의 임의 문자열로 변경
# .env의 IRIS_BASE_URL을 redroid Iris 주소로 변경
# 운영 환경에서는 USER_VERIFICATION_PEPPER를 32자 이상 별도 secret으로 설정
npm.cmd install
npm.cmd run dev
```

## Windows 상시 실행

현재 Windows 사용자 로그인 시 서버를 자동 시작하고, 비정상 종료 시 1분 간격으로 재시작하려면 다음 스크립트를 사용합니다. 관리자 권한 없이 등록되므로 Windows 로그인 전에는 실행되지 않습니다.

```powershell
cd C:\Users\user\Desktop\hoiBot_modernization\개발환경_고도화\runtime
npm.cmd run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-windows-autostart.ps1 -Action Install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-windows-autostart.ps1 -Action Start
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-windows-autostart.ps1 -Action Status
```

작업 이름은 `hoiBot Modernization Server`입니다. 자동 시작을 해제할 때만 `-Action Uninstall`을 사용합니다. 계정 비밀번호, 토큰과 `.env` 내용은 작업 스케줄러 정의나 저장소에 복사하지 않습니다.

## MariaDB 실행 및 연결

`infra/.env.example`을 `infra/.env`로 복사하고 두 비밀번호를 서로 다른 임의 값으로 변경합니다. 실제 `.env`는 Git에 포함하지 않습니다.

```powershell
cd C:\Users\user\Desktop\hoiBot_modernization\개발환경_고도화\infra
Copy-Item .env.example .env
docker compose --env-file .env -f compose.yaml up -d mariadb

cd ..\runtime
# runtime/.env의 DATABASE_* 값을 infra/.env와 맞춤
npm.cmd run db:migrate
npm.cmd run db:probe
npm.cmd run db:probe:modernization
npm.cmd run db:probe:domains # disposable hoibot_import_verify_* DB에서만 실행 가능
npm.cmd run db:probe:signup # disposable hoibot_import_verify_* DB에서만 실행 가능
npm.cmd run db:import:dry-run -- --source ..\..\data
npm.cmd run admin:link-iris -- operator-id kakao-external-user-id
npm.cmd run dev
```

MariaDB는 공식 `11.8.8` 이미지로 고정하며 호스트의 `127.0.0.1:3307`에만 게시합니다. 데이터는 `hoibot_mariadb_data` named volume에 저장됩니다.

`DATABASE_ENABLED=true`이면 `/health/ready`가 매 요청마다 MariaDB `SELECT 1`을 확인합니다. DB가 중단되면 `503 not_ready`, 복구되면 `200 ready`를 반환합니다.

다른 터미널에서 확인합니다.

```powershell
curl.exe http://127.0.0.1:3100/health/live
curl.exe http://127.0.0.1:3100/api/v1/ping
npm.cmd run fake:event
```

## API

| Method | Path | 인증 | 용도 |
| --- | --- | --- | --- |
| GET | `/health/live` | 없음 | 프로세스 생존 확인 |
| GET | `/health/ready` | 없음 | 요청 수신 준비 확인 |
| GET | `/api/v1/ping` | 없음 | HTTP 왕복 확인 |
| GET | `/api/v1/version` | 없음 | Lite 서버 버전 확인 |
| POST | `/api/v1/integrations/iris/events` | 공유 토큰 | Iris 이벤트 수신 |
| GET | `/api/v1/debug/recent-events` | 공유 토큰 | 개발 중 최근 원본 이벤트 조회 |
| POST | `/api/v1/user-accounts` | 없음 | 사이트 계정 생성·Kakao 인증코드 발급 |
| POST | `/api/v1/verification-challenges` | 로그인 정보 | 미인증 계정 코드 재발급 |
| GET | `/api/v1/verification-challenges/:challengeId` | 공개 challenge ID | Kakao 인증 진행 상태 조회 |
| POST | `/api/v1/sessions` | 사용자 계정 | 사용자 로그인·CSRF 발급 |
| GET/DELETE | `/api/v1/sessions/current` | 사용자 세션 | 현재 사용자 세션 조회·종료 |
| POST | `/api/v1/account-deletion-requests` | 사용자 세션+CSRF | 30일 탈퇴 유예 시작 |
| DELETE | `/api/v1/account-deletion-requests/current` | 로그인 정보 | 유예 중 계정 복구 |
| POST | `/api/v1/admin/sessions` | 로컬 계정 | 관리자 로그인·CSRF 발급 |
| GET/DELETE | `/api/v1/admin/sessions/current` | 관리자 세션 | 현재 세션 조회·종료 |
| GET | `/api/v1/admin/overview` | `overview.read` | 운영 현황 조회 |
| GET | `/api/v1/admin/players` | `player.read` | 회원 검색 |
| GET | `/api/v1/admin/players/:playerId` | `player.read` | 회원 ProfileView·제재 조회 |
| PUT | `/api/v1/admin/players/:playerId/server-assignment` | `player.server.assign`+CSRF | 낙관적 잠금 서버 배정 |
| GET/PUT | `/api/v1/admin/external-identities[/:identityId/player-assignment]` | `identity.read/assign` | identity 조회·연결 |
| GET | `/api/v1/admin/game-servers` | `player.read` | 게임 서버 목록 |
| GET | `/api/v1/admin/audit-entries` | `audit.read` | 감사 기록 조회 |
| GET/POST/PATCH | `/api/v1/admin/players/:playerId/restrictions`, `/api/v1/admin/restrictions/:restrictionId` | `account.restrict` | 제재 등록·해제 |
| GET/PATCH | `/api/v1/admin/account-deletion-requests[/:requestId]` | `account.deletion.manage` | 탈퇴 유예 조회·복구 |
| GET/POST/PATCH | `/api/v1/admin/operators[/:operatorId]` | `operator.read/manage` | 운영자 조회·관리 |
| PUT/DELETE | `/api/v1/admin/operators/:operatorId/roles/:roleCode` | `authorization.manage` | 역할 부여·회수 |
| PUT/DELETE | `/api/v1/admin/operators/:operatorId/permission-overrides/:permissionCode` | `authorization.manage` | 개인 권한 allow·deny 관리 |
| GET/PUT/DELETE | `/api/v1/admin/players/:playerId/passes[/:passCode]` | `pass.read/grant/revoke` | 기간형·영구형 프리패스 관리 |

Iris가 사용자 정의 헤더를 설정할 수 없으면 다음과 같이 endpoint에 토큰을 붙입니다.

```text
http://개발PC_IP:3100/api/v1/integrations/iris/events?token=공유토큰
```

Iris 이벤트의 `msg`가 정확히 `/ping`이면 서버는 Iris `/query`로 현재 방·사용자의 `db2.open_chat_member.nickname` 또는 `db2.friends.name`을 확인합니다. 정확히 한 행이 조회되면 DB 닉네임을 사용하고, 일반 단체방처럼 이름 테이블이 없으면 Iris `sender`로 fallback하여 같은 방에 `이름 pong`으로 답합니다.

비운영 환경에서 정확히 `/info`를 입력하면 Iris 최상위 원문, 전달된 `chat_logs` 필드, 서버 정규화 결과, 현재 `chat_logs`, `chat_rooms`, 사용 가능한 신원 테이블, `open_chat_member`, `friends`, `open_link` 조회 결과와 최종 닉네임 판정을 여러 메시지로 나누어 표시합니다. 긴 JSON의 16자리 이상 정수는 반올림되지 않도록 문자열로 펼칩니다. 이 명령은 방·사용자 식별자와 프로필 메타데이터를 표시하므로 production에서는 응답하지 않습니다.

MariaDB가 활성화된 경우 provider event ID를 inbox의 UNIQUE key로 사용합니다. 동일 이벤트는 명령·감사·outbox를 다시 만들지 않습니다. `/내정보`는 승인된 `(provider,user_id) -> player_id` 연결이 있을 때만 응답하며 미연결 사용자는 원문 없이 mapping-needed 진단만 남깁니다.

미가입 사용자가 정확히 `/가입`을 입력하면 Kakao 표시명을 기존 `두 글자 이상 이름 + 공백 + 남/여`와 금칙어 정책으로 검증하고 30분짜리 가입 대기를 MariaDB에 저장합니다. 정확한 `시작한다` 또는 `/시작한다`에서만 약관 동의와 회원 초기 데이터 생성이 한 트랜잭션으로 완료됩니다. `거절한다` 또는 `/거절한다`는 회원을 만들지 않고 대기 상태와 닉네임 예약을 해제합니다. 서버 재시작과 동일 Iris 이벤트 재전송은 중복 회원을 만들지 않습니다.

신규 사이트 가입 흐름은 로그인 ID, 비밀번호, 정확한 `한글 2글자 + 공백 + 남/여` 시스템 이름과 이용약관 동의를 받은 뒤 아직 player를 만들지 않은 미인증 계정을 생성합니다. 개인정보 처리방침의 별도 동의는 받지 않고 최소 계정정보 처리 안내만 표시합니다. 사용자가 현재 KakaoTalk 닉네임을 시스템 이름과 동일하게 맞추고 정확히 `/인증 ABCD2345` 형식으로 입력하면 provider key·닉네임·코드를 함께 검증해 player와 초기 데이터를 한 트랜잭션으로 생성합니다. 닉네임이 다르면 Iris가 현재 전달한 이름과 필요한 시스템 이름을 함께 안내합니다. CAPTCHA는 이번 1차 구현에 포함하지 않습니다.

브라우저를 닫았거나 새로고침한 미인증 사용자는 `로그인 -> 인증 계속하기`에서 아이디·비밀번호를 확인하고 새 코드를 발급받을 수 있습니다. 가입·재발급·로그인 요청은 원문 IP를 저장하지 않는 프로세스 메모리 HMAC 범위 제한을 적용합니다. 일반 사용자 비밀번호를 5회 틀리면 DB에 15분 잠금이 기록됩니다. 24시간이 지난 미인증 계정은 서버 시작 시와 1시간마다 challenge·동의 이력·임시 세션과 함께 삭제됩니다.

오픈채팅 인증에서는 랜덤 프로필을 사용하지 않습니다. 카카오톡 `open_chat_member.nickname`과 시스템 이름이 일치하는 이름 지정 프로필을 사용합니다. Iris의 `/data/local/tmp/names.db`는 `(chat_id,user_id)` 기반 해시 이름 캐시이므로 프로필 변경 직후 이전 표시명을 전달할 수 있습니다. 인증 전 일반 메시지로 Iris의 현재 `sender`가 변경된 이름인지 확인합니다.

최초 관리자는 비밀번호를 명령 인수가 아닌 일시적 환경변수로만 전달해 생성합니다.

```powershell
$env:HOIBOT_BOOTSTRAP_ADMIN_PASSWORD = "12자 이상의 임시 비밀번호"
npm.cmd run admin:bootstrap -- operator-id "운영자 표시명"
Remove-Item Env:HOIBOT_BOOTSTRAP_ADMIN_PASSWORD
```

기존 관리자의 비밀번호를 의도적으로 재설정할 때만 마지막 인수에 `--reset-password`를 추가합니다. 재설정 시 해당 관리자의 기존 세션은 모두 폐기됩니다.

`--allow-insecure-local`은 로컬 개발에서만 짧은 임시 비밀번호를 허용하는 예외입니다. production 환경에서는 이 옵션이 있어도 12자 미만 비밀번호를 거부하며 운영 배치에는 사용하지 않습니다. 관리자 웹 로그인 경로는 `/admin`입니다.

`IRIS_IMAGE_FORWARD_ROOM_ID`를 `/ping` 테스트방의 ID로 설정하면 다른 방에서 감지된 모든 `type=2` 단일 이미지를 테스트방으로 전달합니다. 테스트방에서 감지된 이미지는 다시 전달하지 않아 반복되지 않습니다. 서버는 허용된 Kakao CDN HTTPS URL만 사용하고 이미지 MIME, `IMAGE_MAX_BYTES`, `IMAGE_DOWNLOAD_TIMEOUT_MS` 제한을 적용합니다. 방 ID는 `.env.example`이나 문서에 기록하지 않습니다. 다중 이미지는 별도 검증 전까지 전달하지 않습니다.

비운영 환경에서 `IRIS_EVENT_MONITOR_ROOM_ID`를 TEST 방 ID로 설정하면 Iris가 서버로 전달한 이벤트 중 일반 텍스트를 제외한 이벤트를 해당 방에 텍스트 요약으로 보냅니다. `type=1 + MSG/WRITE`는 기본 제외하지만 `mentions` 또는 봇 멘션 메타데이터가 있으면 멘션 이벤트로 출력합니다. 이미지·답글·수정·삭제·입장·퇴장·이모티콘·미분류 이벤트 후보도 출력합니다. 요약에는 분류 후보, `type`, `origin`, 방향, 방·사용자 식별자, 메시지와 attachment/v 필드명만 포함합니다. 이미지 이벤트도 `단일/다중 이미지 감지`라는 텍스트만 보내며 이미지 파일·URL·썸네일은 전달하지 않습니다. 모니터 메시지에는 고정 prefix를 사용하고 이를 재수신하면 다시 출력하지 않아 무한 반복을 막습니다. production에서는 설정값과 관계없이 비활성화됩니다.

서버 로그에는 쿼리 문자열을 제외한 경로만 기록합니다. 실제 운영 환경에서는 HTTPS 또는 사설망, 방화벽/IP 제한을 추가해야 합니다.

## 검증

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run db:migrate
npm.cmd run db:probe
npm.cmd run db:probe:modernization
npm.cmd run db:probe:signup
npm.cmd run account:cleanup
npm.cmd run db:import:dry-run -- --source ..\..\data
```

`db:probe:domains`와 `db:probe:signup`은 도메인 또는 가입 데이터를 실제로 변경하므로 단독으로 개발/운영 DB에서 실행할 수 없습니다. `probe-disposable-import.ps1`이 생성한 `hoibot_import_verify_*` 임시 DB에서만 허용됩니다.

전체 migration과 legacy import를 임시 DB에서 검증하거나, 현재 DB backup을 임시 DB에 복원해 검증할 때는 다음 스크립트를 사용합니다. 두 스크립트 모두 검증용 DB를 끝에 제거하며 운영 JSON을 수정하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ..\infra\scripts\probe-disposable-import.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ..\infra\scripts\backup-restore-verify.ps1
```

# hoiBot Server modernization runtime

Iris 입출력과 MariaDB 도메인 이전을 검증하는 TypeScript/Fastify 서버입니다. 기존 MessengerBot R의 `main.js`, `Info.js`, Android JSON 원본은 변경하지 않습니다.

## 포함 범위

- 모든 요청에 UUID 기반 `requestId` 발급 및 `x-request-id` 응답 헤더 제공
- Iris 원본 payload 구조화 로그 및 개발용 최근 이벤트 메모리 조회
- 기본 1MiB 요청 크기 제한
- Bearer, `x-iris-token`, Iris endpoint 쿼리 토큰 인증
- health, ready, ping, version API
- 정확한 `/ping` 이벤트에 `발신자이름 pong`으로 답하는 Iris 연결 확인 명령
- MariaDB 연결 풀, DB 기반 readiness, 버전 관리 마이그레이션과 롤백·재시작 probe
- 파라미터 SQL Repository와 `withTransaction()` 트랜잭션 계약
- Iris event inbox, 명령 중복 방지, operation/audit/outbox와 background 재시도
- `/내정보` ProfileView/legacy formatter와 승인된 Kakao identity 기반 조회
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
| POST | `/api/v1/admin/auth/login` | 로컬 계정 | 관리자 로그인·CSRF 발급 |
| GET | `/api/v1/admin/session` | 관리자 세션 | 현재 세션·권한 조회 |
| DELETE | `/api/v1/admin/auth/session` | 세션+CSRF | 로그아웃 |
| GET | `/api/v1/admin/players` | `player.read` | 회원 검색 |
| GET | `/api/v1/admin/players/:playerId/profile` | `player.read` | 회원 ProfileView 조회 |
| PATCH | `/api/v1/admin/players/:playerId/server` | `player.server.change`+CSRF | 낙관적 잠금 서버 변경 |
| GET | `/api/v1/admin/identity-candidates` | `identity.approve` | identity 후보 조회 |
| POST | `/api/v1/admin/identity-candidates/:id/approve` | `identity.approve`+CSRF | 후보 승인 |
| GET | `/api/v1/admin/game-servers` | `player.read` | 게임 서버 목록 |
| GET | `/api/v1/admin/audit` | `audit.read` | 감사 기록 조회 |

Iris가 사용자 정의 헤더를 설정할 수 없으면 다음과 같이 endpoint에 토큰을 붙입니다.

```text
http://개발PC_IP:3100/api/v1/integrations/iris/events?token=공유토큰
```

Iris 이벤트의 `msg`가 정확히 `/ping`이고 `sender`, `json.chat_id`가 있으면 서버는 `IRIS_BASE_URL/reply`를 호출해 같은 방에 `발신자이름 pong`으로 답합니다.

MariaDB가 활성화된 경우 provider event ID를 inbox의 UNIQUE key로 사용합니다. 동일 이벤트는 명령·감사·outbox를 다시 만들지 않습니다. `/내정보`는 승인된 `(provider,user_id) -> player_id` 연결이 있을 때만 응답하며 미연결 사용자는 원문 없이 mapping-needed 진단만 남깁니다.

최초 관리자는 비밀번호를 명령 인수가 아닌 일시적 환경변수로만 전달해 생성합니다.

```powershell
$env:HOIBOT_BOOTSTRAP_ADMIN_PASSWORD = "12자 이상의 임시 비밀번호"
npm.cmd run admin:bootstrap -- operator-id "운영자 표시명"
Remove-Item Env:HOIBOT_BOOTSTRAP_ADMIN_PASSWORD
```

`IRIS_IMAGE_FORWARD_ROOM_ID`를 `/ping` 테스트방의 ID로 설정하면 다른 방에서 감지된 모든 `type=2` 단일 이미지를 테스트방으로 전달합니다. 테스트방에서 감지된 이미지는 다시 전달하지 않아 반복되지 않습니다. 서버는 허용된 Kakao CDN HTTPS URL만 사용하고 이미지 MIME, `IMAGE_MAX_BYTES`, `IMAGE_DOWNLOAD_TIMEOUT_MS` 제한을 적용합니다. 방 ID는 `.env.example`이나 문서에 기록하지 않습니다. 다중 이미지는 별도 검증 전까지 전달하지 않습니다.

서버 로그에는 쿼리 문자열을 제외한 경로만 기록합니다. 실제 운영 환경에서는 HTTPS 또는 사설망, 방화벽/IP 제한을 추가해야 합니다.

## 검증

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run db:migrate
npm.cmd run db:probe
npm.cmd run db:probe:modernization
npm.cmd run db:import:dry-run -- --source ..\..\data
```

`db:probe:domains`는 재화·인벤토리·펫/스킬/타이틀·길드·홈·이벤트/랭킹·거래소를 실제로 변경하므로 단독으로 개발/운영 DB에서 실행할 수 없습니다. `probe-disposable-import.ps1`이 생성한 `hoibot_import_verify_*` 임시 DB에서만 허용됩니다.

전체 migration과 legacy import를 임시 DB에서 검증하거나, 현재 DB backup을 임시 DB에 복원해 검증할 때는 다음 스크립트를 사용합니다. 두 스크립트 모두 검증용 DB를 끝에 제거하며 운영 JSON을 수정하지 않습니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ..\infra\scripts\probe-disposable-import.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ..\infra\scripts\backup-restore-verify.ps1
```

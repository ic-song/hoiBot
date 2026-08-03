# hoiBot Lite server

Iris 연계 전에 HTTP 수신 경로와 기본 안전장치를 검증하는 독립 Node.js 서버입니다. 기존 MessengerBot R의 `main.js`, `Info.js`, Android JSON 데이터는 사용하거나 변경하지 않습니다.

## 포함 범위

- 모든 요청에 UUID 기반 `requestId` 발급 및 `x-request-id` 응답 헤더 제공
- Iris 원본 payload 구조화 로그 및 개발용 최근 이벤트 메모리 조회
- 기본 1MiB 요청 크기 제한
- Bearer, `x-iris-token`, Iris endpoint 쿼리 토큰 인증
- health, ready, ping, version API
- 정확한 `/ping` 이벤트에 `발신자이름 pong`으로 답하는 Iris 연결 확인 명령
- MariaDB 연결 풀, DB 기반 readiness, 버전 관리 마이그레이션과 롤백·재시작 probe
- 정상 종료 처리와 가짜 Iris 이벤트 전송 스크립트

게임 데이터의 실제 JSON→MariaDB 이전, 게임 명령 처리, `/ping` 외 일반 Iris 응답 처리, ADB 제어, 웹 관리 화면은 아직 포함하지 않습니다.

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

Iris가 사용자 정의 헤더를 설정할 수 없으면 다음과 같이 endpoint에 토큰을 붙입니다.

```text
http://개발PC_IP:3100/api/v1/integrations/iris/events?token=공유토큰
```

Iris 이벤트의 `msg`가 정확히 `/ping`이고 `sender`, `json.chat_id`가 있으면 서버는 `IRIS_BASE_URL/reply`를 호출해 같은 방에 `발신자이름 pong`으로 답합니다.

`IRIS_IMAGE_FORWARD_ROOM_ID`를 `/ping` 테스트방의 ID로 설정하면 다른 방에서 감지된 모든 `type=2` 단일 이미지를 테스트방으로 전달합니다. 테스트방에서 감지된 이미지는 다시 전달하지 않아 반복되지 않습니다. 서버는 허용된 Kakao CDN HTTPS URL만 사용하고 이미지 MIME, `IMAGE_MAX_BYTES`, `IMAGE_DOWNLOAD_TIMEOUT_MS` 제한을 적용합니다. 방 ID는 `.env.example`이나 문서에 기록하지 않습니다. 다중 이미지는 별도 검증 전까지 전달하지 않습니다.

서버 로그에는 쿼리 문자열을 제외한 경로만 기록합니다. 실제 운영 환경에서는 HTTPS 또는 사설망, 방화벽/IP 제한을 추가해야 합니다.

## 검증

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run db:migrate
npm.cmd run db:probe
```

# hoiBot Lite server

Iris 연계 전에 HTTP 수신 경로와 기본 안전장치를 검증하는 독립 Node.js 서버입니다. 기존 MessengerBot R의 `main.js`, `Info.js`, Android JSON 데이터는 사용하거나 변경하지 않습니다.

현재 확정된 redroid 실행환경과 검증 상태는 `../개발환경_고도화/CURRENT_STATE.md`를 기준으로 확인합니다.

## 포함 범위

- 모든 요청에 UUID 기반 `requestId` 발급 및 `x-request-id` 응답 헤더 제공
- Iris 원본 payload 구조화 로그 및 개발용 최근 이벤트 메모리 조회
- 기본 1MiB 요청 크기 제한
- Bearer, `x-iris-token`, Iris endpoint 쿼리 토큰 인증
- health, ready, ping, version API
- 정상 종료 처리와 가짜 Iris 이벤트 전송 스크립트

DB, 게임 명령 처리, Iris `/reply`, ADB 제어, 웹 관리 화면은 아직 포함하지 않습니다.

## 설치 및 실행

PowerShell 실행 정책과 무관하게 `npm.cmd`를 사용합니다.

```powershell
cd C:\Users\user\Desktop\hoiBot\runtime
Copy-Item .env.example .env
# .env의 IRIS_SHARED_TOKEN을 16자 이상의 임의 문자열로 변경
npm.cmd install
npm.cmd run dev
```

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

서버 로그에는 쿼리 문자열을 제외한 경로만 기록합니다. 실제 운영 환경에서는 HTTPS 또는 사설망, 방화벽/IP 제한을 추가해야 합니다.

redroid와 hoiBot Lite 서버 사이의 실제 호스트 주소와 포트 전달 방식은 현재 환경에서 다시 확인한 뒤 endpoint에 적용합니다.

## 검증

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

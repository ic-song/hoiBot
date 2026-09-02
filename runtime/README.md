# hoiBot Lite server

Iris 연계 전에 HTTP 수신 경로와 기본 안전장치를 검증하는 독립 Node.js 서버입니다. 기존 MessengerBot R의 `main.js`, `Info.js`, Android JSON 데이터는 사용하거나 변경하지 않습니다.

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

## 검증

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## 운영 RAW 스냅샷 검증

운영 데이터 원문을 출력하지 않고 경로 해시, 파일 크기와 내용 SHA-256으로 manifest를 생성합니다. 모든 JSON은 UTF-8 디코딩과 파싱을 함께 검사합니다.

```powershell
npm.cmd run snapshot:validate -- --source ..\data --output ..\snapshot-evidence\source-manifest.json --label operational-source
```

격리 환경에 업로드한 뒤 다시 내려받은 디렉터리는 원본 manifest와 비교합니다.

```powershell
npm.cmd run snapshot:validate -- --source C:\Temp\hoibot-downloaded --output ..\snapshot-evidence\downloaded-manifest.json --compare ..\snapshot-evidence\source-manifest.json --label isolated-download
```

manifest에는 데이터 내용과 실제 파일명이 들어가지 않습니다. 이 절차는 운영 DB 반영이나 `feature/prod` 갱신을 수행하지 않습니다.

## 데이터 필터 결정 manifest

필터 정책 `DATA-FILTER-v1`은 원본을 변경하지 않고 각 파일을 `KEEP`, `QUARANTINE`, `EXCLUDE`, `REVIEW`로 분류합니다.

```powershell
npm.cmd run snapshot:classify -- --source ..\data --output ..\snapshot-evidence\filter-decisions.json --label operational-source
```

- 유효한 JSON/TXT는 기본적으로 `KEEP`입니다.
- 실행 코드와 민감정보 키 범주가 확인된 파일은 원문을 노출하지 않고 `REVIEW`합니다.
- 파싱·UTF-8 실패와 지원하지 않는 형식은 `QUARANTINE`합니다.
- `EXCLUDE`는 검토자가 명시한 경로 SHA-256에만 적용하며 파일명 추정으로 제외하지 않습니다.
- 결과에는 경로·내용 SHA-256, 크기, 판정 사유와 민감 키 범주만 저장합니다.

## 격리 staging 변환

필터 결정 manifest와 승인 자산 카탈로그 버전을 고정한 뒤, 실제 payload는 Git에서 제외된 `staging-private/`에 해시 파일명으로 생성합니다.

```powershell
npm.cmd run snapshot:stage -- --source ..\data --decisions ..\snapshot-evidence\filter-decisions.json --staging .\staging-private\WBS688 --output ..\snapshot-evidence\staging-transform.json --catalog-version ASSET-FREEZE-v2.435-8f075b4e-02
```

원본 파일은 수정하지 않습니다. 같은 입력을 다시 실행하면 기존 payload 해시를 확인해 추가 파일 없이 재사용하고, source/decision 불일치나 예상 밖 staging 파일은 즉시 차단합니다. 커밋되는 변환 manifest에는 원문 payload와 실제 파일명이 포함되지 않습니다.

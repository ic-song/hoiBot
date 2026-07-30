# 다음 작업 기록

최초 작성일: 2026-06-22

최근 갱신일: 2026-07-30

## 현재 확정된 방향

AS-IS는 LDPlayer 안에서 KakaoTalk, 메신저봇R, hoiBot script, JSON 데이터가 함께 동작하는 구조다.

TO-BE는 LDPlayer를 KakaoTalk 입출력 환경으로 축소하고, 운영 PC의 hoiBot Server가 로직, 데이터, 플랫폼 확장의 중심이 되는 구조다.

```text
AS-IS
LDPlayer
-> KakaoTalk
-> 메신저봇R
-> main.js / Info.js
-> LDPlayer 내부 JSON
```

```text
TO-BE
LDPlayer
-> KakaoTalk
-> Iris
-> 운영 PC hoiBot Server(HTTP/WS)
-> PC 쪽 DB/데이터
-> Discord 등 다른 플랫폼 adapter
```

## 운영 PC 현재 상태

- LDPlayer 설치 완료
- LDPlayer 안의 KakaoTalk 설치 완료
- 메신저봇R은 AS-IS 운영환경으로 설치되어 있음
- 개발 PC LDPlayer 9에서는 Iris HTTP 이벤트 수신 선행 검증 완료
- 운영 PC에서의 Iris 재현 검증은 아직 진행 전
- 기존 메신저봇R 운영을 바로 건드리지 않고, Iris는 테스트방 기준으로 별도 검증한다.

## 2026-07-30 진행 기록

- `runtime/`에 hoiBot Lite 서버 기반을 구성했다.
- health, ping, version, Iris 이벤트 수신, 인증, body 제한, 최근 이벤트 조회 기능을 구현했다.
- Iris 이벤트 2,050건이 HTTP 202로 수신되는 것을 확인했다.
- 개인정보를 제외한 표본 7건과 논리 시나리오 4개를 분석했다.
- 동일 계정 식별 비교, 연속 메시지 3건의 중복 전달 없음, 메시지 삭제 이벤트를 확인했다.
- 상세 결과와 미검증 범위는 `IRIS_TEST_RESULTS_20260730.md`에 기록했다.
- 실제 방·사용자·메시지 정보가 포함된 원본 로그와 `.env`는 Git에서 제외한다.

## 주요 결정

- `hoiBot`은 봇/프로젝트 이름이다.
- 현재 실행환경은 메신저봇R이다.
- TO-BE 실행환경 후보는 Iris다.
- `Iris.apk`는 Android/LDPlayer 안에 설치되는 Iris 본체다.
- `iris_control.ps1`은 필수가 아니라 ADB 명령을 묶은 Windows용 관리 스크립트다.
- 아키텍처상 필수에 가까운 것은 `Iris.apk`와 ADB 접근이다.
- `iris_control.ps1`은 아키텍처 필수 요소가 아니라 ADB 제어를 자동화한 참고용 관리 스크립트다.
- TO-BE의 운영 제어 계층은 `.bat`가 아니라 운영 PC의 hoiBot Server가 제공하는 WS/HTTP 관리 API다.
- 단, Iris 최초 설치 전에는 WS 서버가 아직 없을 수 있으므로 최소 부트스트랩/점검용 `.bat`는 임시 도구로 둘 수 있다.
- 최종 목표는 다른 플랫폼이나 운영 도구가 WS/HTTP로 운영 PC hoiBot Server에 연결하고, 서버가 필요한 경우 ADB를 호출해 LDPlayer/Iris를 제어하는 구조다.

## 다음 구현 후보

다음 작업은 운영 PC hoiBot Server의 WS/HTTP 관리 구조를 먼저 설계하고, 필요한 경우 초기 설치 전용 최소 점검 도구를 별도로 준비하는 것이다.

초기 부트스트랩 후보:

```text
개발환경_고도화/tools/
├─ 00_bootstrap_check.bat
├─ 01_install_iris_apk.bat
└─ README.md
```

TO-BE 서버 후보:

```text
runtime/
├─ hoibot_server.js
├─ adapters/
│  ├─ iris_adapter.js
│  └─ discord_adapter.js
├─ control/
│  ├─ adb_controller.js
│  └─ iris_controller.js
└─ data/
```

## 1차 작업: WS/HTTP 관리 API 설계

운영 PC hoiBot Server는 외부 플랫폼과 운영 도구가 붙을 수 있는 중심 서버가 된다.

초기 API 후보:

- `GET /health`: 서버 상태 확인
- `GET /iris/status`: Iris/LDPlayer 상태 확인
- `POST /iris/start`: Iris 시작 요청
- `POST /iris/stop`: Iris 중지 요청
- `WS /events`: KakaoTalk/Discord/운영 이벤트 스트림
- `WS /control`: 운영 명령 수신

주의:

- WS/HTTP 서버가 ADB를 직접 호출할 수는 있지만, 위험한 명령은 인증/권한 확인 뒤 실행해야 한다.
- 운영 데이터 삭제, 메신저봇R 파일 변경, LDPlayer 강제 초기화 같은 동작은 기본 API에 넣지 않는다.

## 2차 작업: 초기 환경점검 도구

`00_bootstrap_check.bat`는 WS 서버 구축 전 운영 PC 상태만 확인하는 임시 도구다.

확인 항목:

- LDPlayer 설치 경로 존재 여부
- `adb.exe` 존재 여부
- `ldconsole.exe` 존재 여부
- LDPlayer 인스턴스 목록
- `adb devices` 결과
- 연결된 device 개수
- LDPlayer shell 접근 가능 여부
- 결과 로그 저장

주의:

- 기존 메신저봇R 파일을 수정하지 않는다.
- 운영 데이터 파일을 건드리지 않는다.
- 여러 LDPlayer 인스턴스가 있으면 자동 선택하지 않고 중단한다.

## 3차 작업: Iris APK 설치 도구

`01_install_iris_apk.bat`는 환경점검 통과 후 만든다. 최종적으로는 같은 기능을 hoiBot Server의 관리 API 또는 내부 controller로 옮긴다.

예상 확인/동작:

- `Iris.apk` 존재 확인
- 연결된 LDPlayer device가 정확히 1개인지 확인
- `/data/local/tmp/Iris.apk`로 push
- 설치 또는 실행 준비
- 결과 로그 저장

주의:

- 설치 전에 기존 KakaoTalk/메신저봇R을 삭제하지 않는다.
- 계정 로그인 상태를 변경하지 않는다.
- 실패 시 로그만 남기고 중단한다.

## 구현 가능성 판단

현재 판단은 `FEASIBILITY_CHECK.md`에 기록했다.

요약:

```text
아키텍처 방향: 가능
Iris 사용: 가능성 높음
LDPlayer 호환성: 실제 검증 필요
기존 main.js 즉시 이식: 위험
점진 이전: 권장
Discord 확장: 서버 중심화 후 가능
```

## 다음에 이어서 할 일

1. 운영 PC 백업과 환경값 기록
2. 운영 PC에서 `IRIS_INSTALL_RUNBOOK.md` 기준으로 Iris 설치·상태 확인
3. 운영 PC 별도 테스트방에서 HTTP 이벤트 수신 재검증
4. Iris `/reply`를 이용한 ping/pong 전체 왕복 검증
5. Iris WebSocket `/ws` 수신 검증
6. 이벤트 정규화와 멱등 처리 정책 설계
7. `Info.js` 읽기 전용 명령 하나를 adapter로 연결
8. PC 쪽 데이터 저장소 설계

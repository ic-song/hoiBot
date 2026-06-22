# hoiBot Iris TO-BE 아키텍처

## AS-IS

현재 hoiBot은 LDPlayer 안에서 카카오톡과 메신저봇R이 함께 동작하는 구조다.

```text
LDPlayer
-> KakaoTalk
-> 메신저봇R
-> main.js / Info.js
-> /storage/emulated/0 또는 /sdcard 아래 JSON 데이터
```

AS-IS에서는 메시지 수신, 명령 실행, 데이터 읽기/쓰기, 답장 전송이 대부분 LDPlayer 안에서 처리된다.

## TO-BE

TO-BE에서는 LDPlayer를 카카오톡 입출력 환경으로 낮추고, 운영 PC의 hoiBot Server가 중심이 된다.

```text
LDPlayer
-> KakaoTalk
-> Iris
   -> HTTP endpoint 또는 WebSocket

운영 PC hoiBot Server
-> Iris adapter
-> hoiBot command engine
-> PC 쪽 DB/데이터
-> Discord adapter
-> Admin/운영 도구 adapter
-> WS/HTTP 관리 API
```

## 역할 분리

### LDPlayer

- Android 실행 환경
- KakaoTalk 봇 계정 로그인
- Iris.apk 실행
- 카카오톡 메시지 감지와 답장 전송의 Android 측 통로 제공

### Iris

- 메신저봇R을 대체할 카카오톡 메시지 감지/답장 계층
- KakaoTalk DB 변경 감지
- HTTP endpoint 또는 WebSocket으로 이벤트 전달
- `/reply` 계열 API로 KakaoTalk 답장 전송

### 운영 PC hoiBot Server

- hoiBot 실제 로직 실행의 중심
- Iris 이벤트를 기존 `response(room, msg, sender, ...)` 형태로 변환
- 답장 결과를 Iris `/reply` 요청으로 변환
- PC 쪽 DB/파일 관리
- Discord 등 다른 플랫폼 연결
- WS/HTTP 관리 API 제공
- 필요 시 내부 controller를 통해 ADB로 LDPlayer/Iris 상태 확인

### 개발 PC

- Codex로 코드 작성
- Git commit/push
- 운영 PC는 Git pull로 반영

## 데이터 위치 변경

```text
AS-IS
LDPlayer 내부 JSON

TO-BE
운영 PC hoiBot Server의 DB 또는 파일 저장소
```

데이터를 PC로 옮기면 백업, 검증, 다른 플랫폼 연동, 운영 도구 제작이 쉬워진다. 반대로 기존 `loadJsonFile` / `saveJsonFile` 흐름을 서버 저장소에 맞게 점진적으로 바꾸는 작업이 필요하다.

## 플랫폼 확장

TO-BE의 핵심은 KakaoTalk만 처리하는 봇이 아니라, 여러 플랫폼이 같은 hoiBot Server에 붙는 구조다.

```text
KakaoTalk via Iris
Discord Bot
Admin Web/CLI
운영 자동화 도구
        |
        v
hoiBot Server
```

Discord는 카카오톡과 같은 명령 엔진을 공유하되, 입력/출력 adapter만 다르게 두는 방향이 적절하다.

## 운영 제어 계층

TO-BE에서 운영 제어의 중심은 `.bat` 파일이 아니라 운영 PC hoiBot Server가 제공하는 WS/HTTP API다.

```text
운영 도구 / Discord 관리자 명령 / Web UI
-> WS/HTTP
-> hoiBot Server
-> controller
-> ADB
-> LDPlayer / Iris
```

`iris_control.ps1`은 참고용 관리 스크립트이며 아키텍처 필수 요소가 아니다. 초기 설치 전에는 서버가 아직 없을 수 있으므로, 최소한의 부트스트랩 도구로 `.bat`를 사용할 수는 있다. 최종 운영 제어는 서버 API로 옮기는 것이 목표다.

## 단계별 전환

1. Iris 설치와 KakaoTalk 감지 확인
2. 운영 PC에서 Iris 이벤트 수신 확인
3. 단순 ping 명령 답장 PoC
4. `Info.js` 같은 읽기 전용 명령 일부 연결
5. PC 쪽 데이터 저장소 설계 및 읽기 테스트
6. 쓰기/저장 명령 이전
7. Discord adapter 추가
8. 메신저봇R 의존 제거 여부 판단

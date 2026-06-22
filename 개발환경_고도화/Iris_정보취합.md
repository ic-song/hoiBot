# Iris 정보취합

이 문서는 hoiBot 개발환경 고도화를 위해 Iris 카카오톡봇 환경을 조사한 내용을 정리한다.
현재 hoiBot은 MessengerBot/Rhino JavaScript 기반이므로, Iris 적용은 단순 설정 변경이 아니라 실행환경 전환 또는 호환 어댑터 설계에 가깝다.

---

## 1. Iris 개요

Iris는 Android 기기에서 동작하는 카카오톡 봇 프레임워크다.
사용자 제공 네이버 카페 글 기준으로는 “안드로이드 위에서 동작하는 DB 기반 봇 프레임워크”로 설명된다.

확인된 공식 저장소:

- https://github.com/dolidolih/Iris

공식 저장소 설명:

- Android native DB observer
- message broker
- reply sender
- Kakaotalk bot framework

KBotDocs 설명 기준으로 Iris는 카카오톡과의 상호작용을 자동화하고, 카카오톡 데이터베이스에서 데이터를 추출하며, HTTP 서버를 통해 원격 제어하기 위한 서버 애플리케이션이다.

참고 문서:

- https://kbotdocs.dev/reference/iris
- https://kbotdocs.dev/reference/iris/get-started

사용자 제공 자료:

- 네이버 카페 글: `http://cafe.naver.com/devlobots/7597`
- 현재 Codex 웹 접근에서는 네이버 카페 원문을 직접 열람하지 못했으므로, 사용자가 대화에 붙여준 본문 내용을 기준으로 취합했다.

---

## 2. 기존 MessengerBot/Rhino 방식과의 차이

현재 hoiBot의 기본 실행환경:

```text
Android MessengerBot
-> Rhino JavaScript
-> response(room, msg, sender, isGroupChat, replier, imageDB, packageName)
-> replier.reply(...)
```

Iris 방식:

```text
Android 기기의 Iris
-> 카카오톡 DB 감시
-> HTTP/WebSocket으로 외부 서버에 메시지 이벤트 전달
-> 외부 서버가 봇 로직 처리
-> Iris HTTP API로 답장 전송
```

핵심 차이:

- MessengerBot은 JavaScript 파일이 Android 앱 내부에서 직접 실행된다.
- Iris는 Android 쪽에서 메시지 감지/전송을 맡고, 봇 로직은 별도 HTTP 서버 또는 WebSocket 클라이언트가 처리한다.
- MessengerBot의 `response(...)`, `replier.reply(...)`, `FileStream` API는 Iris에 그대로 존재하지 않는다.
- Iris 적용 시 hoiBot 로직을 그대로 넣기보다, 메시지 입력과 응답 출력을 변환하는 어댑터가 필요하다.

알림 기반 봇 구동앱과 비교한 차이:

- 메신저봇, 스타라이트, 채자봇 등은 보통 알림 기반으로 메시지 이벤트를 받는다.
- Iris는 알림 이벤트 자체가 아니라 카카오톡 DB 변화를 일정 시간마다 감지하는 polling 방식에 가깝다.
- 알림 기반 봇은 알림에 포함된 답장 action을 사용하는 경우가 많지만, Iris는 카카오톡 앱 내부 저장소에서 `noti_referer` 등을 추출하고 `REPLY_MESSAGE` action이 설정된 Intent를 직접 생성해 카카오톡 내부 서비스에 전달하는 방식으로 설명된다.
- HTTP 또는 WebSocket만 가능하다면 Python, TypeScript, PHP 등 원하는 언어로 Iris-client를 만들 수 있다.

---

## 3. 요구사항

KBotDocs와 GitHub README 기준 요구사항:

- 카카오톡이 설치된 Android 기기
- 카카오톡 데이터베이스 및 일부 시스템 서비스 접근을 위한 Root 권한
- Iris와 상호작용할 HTTP 서버 또는 WebSocket 클라이언트
- ADB 사용 가능 환경

사용자 제공 자료 기준 추가 설명:

- Windows에서는 Android Studio AVD 또는 Android 9 이상 에뮬레이터를 사용할 수 있다.
- Linux에서는 redroid 환경에서 구동하는 사례가 언급된다.
- 카카오톡 앱 내부 저장소는 일반 환경에서 앱 본인만 접근 가능하므로, 루팅 또는 그에 준하는 접근 권한 확보가 필요하다.

설치 흐름 요약:

```text
Iris.apk 다운로드
iris_control 또는 iris_control.ps1 다운로드
adb push Iris.apk /data/local/tmp
iris_control.ps1 install
iris_control.ps1 start
```

Windows에서는 `iris_control.ps1`을 사용한다.

---

## 4. Iris 설정

Iris 실행 후 브라우저에서 아래 대시보드에 접속해 설정한다.

```text
http://[ANDROID_IP]:3000/dashboard
```

주요 설정값:

- `Bot Name`: 봇 이름
- `Web Server Endpoint`: 새 카카오톡 메시지를 전달받을 외부 서버 URL
- `DB Polling Rate`: 카카오톡 DB 변경 확인 주기(ms)
- `Message Send Rate`: 메시지 전송 간 최소 간격(ms)
- `Bot Port`: Iris HTTP 서버 포트

주의:

- DB Polling Rate가 낮을수록 메시지 감지는 빨라질 수 있지만 CPU 사용량이 증가할 수 있다.
- Bot Port 변경은 재시작이 필요할 수 있다.

---

## 5. 주요 HTTP API

Iris는 HTTP API를 통해 메시지 전송, DB 조회, 설정 변경을 제공한다.

### `/reply`

카카오톡 채팅방에 텍스트 또는 이미지를 전송한다.

요청 예시:

```json
{
  "type": "text",
  "room": "[CHAT_ROOM_ID]",
  "data": "[MESSAGE_TEXT]"
}
```

hoiBot의 `replier.reply(text)`를 Iris로 옮길 때 가장 직접적으로 연결될 API다.

### `/query`

카카오톡 데이터베이스에 SQL 쿼리를 실행한다.
응답에서 암호화된 필드를 자동 복호화하는 기능이 있다.

### `/decrypt`

카카오톡 메시지를 복호화한다.

### `/aot`

AOT 관련 토큰을 반환한다.

### `/config`

현재 Iris 설정을 조회한다.

### `/config/endpoint`

메시지 전달을 받을 외부 서버 엔드포인트를 변경한다.

### `/config/dbrate`

DB polling rate를 변경한다.

### `/config/sendrate`

메시지 전송 간격을 변경한다.

### `/config/botport`

Iris HTTP 서버 포트를 변경한다.

### `/ws`

WebSocket 연결을 생성한다.
Iris가 메시지를 감지하면 WebSocket으로 이벤트를 전달할 수 있다.

---

## 5-1. Iris와 Iris-client의 역할

Iris는 Android와 Iris-client 사이의 미들웨어 역할을 한다.

Iris의 역할:

- 카카오톡 DB 감시
- DB 변화 처리
- 메시지 답장 전송
- 메시지 이벤트 발생 시 Iris-client로 이벤트 전달

Iris-client의 역할:

- Iris가 전달한 메시지 이벤트 수신
- 사용자 봇 로직 실행
- 답장이 필요하면 Iris로 답장 요청 전송

역할 관계는 방향에 따라 바뀐다.

```text
메시지 이벤트 전달:
Iris -> Iris-client
Iris = HTTP/WebSocket client
Iris-client = HTTP/WebSocket server

답장 요청:
Iris-client -> Iris
Iris-client = HTTP client
Iris = HTTP server
```

사용자 제공 자료에서 언급된 Iris-client 예시:

- `Irispy-client`
- `Irispy2`
- `IrisTs`
- `IrisEx`
- `IrisPHP`

`iris_bot`은 `irispy-client` 모듈을 사용하는 Python 기반 샘플 봇으로 설명된다.

---

## 6. 메시지 이벤트 형태

Iris는 카카오톡 DB에서 새 메시지를 감지하면 설정된 `web_server_endpoint`로 이벤트를 전달한다.
WebSocket 연결이 있으면 `/ws`를 통해서도 이벤트를 전달한다.

문서에서 확인되는 주요 필드:

```json
{
  "msg": "[DECRYPTED_MESSAGE_CONTENT]",
  "room": "[CHAT_ROOM_NAME]",
  "sender": "[SENDER_NAME]",
  "json": {
    "_id": "...",
    "chat_id": "...",
    "user_id": "...",
    "message": "[DECRYPTED_MESSAGE_CONTENT]",
    "attachment": "[DECRYPTED_ATTACHMENT_INFO]"
  }
}
```

hoiBot의 기존 `response(...)` 인자로 매핑하면 대략 다음과 같다.

| hoiBot/MessengerBot | Iris 이벤트 후보 |
| --- | --- |
| `msg` | `msg` |
| `room` | `room` 또는 `json.chat_id` |
| `sender` | `sender` |
| `isGroupChat` | Iris 이벤트만으로 확정 어려움 |
| `replier.reply(...)` | `/reply` API |
| `imageDB` | 별도 매핑 필요 |
| `packageName` | 별도 매핑 필요 |

---

## 7. hoiBot 적용 관점

현재 hoiBot은 다음 전제에 강하게 묶여 있다.

- `response(...)` 콜백 진입점
- `replier.reply(...)`
- Android MessengerBot 제공 API
- `/sdcard/호이랜드/` 파일 저장
- `/sdcard/호이랜드_dev/` DEV/Test 데이터 저장
- Rhino JavaScript 호환성

Iris 적용 시 필요한 핵심 작업:

1. Iris 이벤트를 hoiBot 명령 처리 입력으로 변환한다.
2. `replier.reply(...)`와 유사한 객체를 만들어 `/reply` API로 전송한다.
3. `FileStream` 기반 저장 흐름을 유지할지, 서버 파일시스템으로 옮길지 결정한다.
4. Android 저장 경로(`/sdcard/호이랜드/`)와 개발 서버 저장 경로를 어떻게 매핑할지 정한다.
5. `Api.replyRoom`, `Device`, `android.os.*`, `java.io.*` 사용 지점을 조사해 대체 가능성을 판단한다.
6. 다중 응답, allsee 포맷, 이미지/첨부 응답, 방 ID와 방 이름 매핑을 검증한다.

---

## 8. 가능한 고도화 방향

### A. Iris를 개발용 입출력 어댑터로 사용

Iris는 메시지 수신/답장만 담당하고, hoiBot 명령 처리는 별도 서버에서 수행한다.

장점:

- PC에서 서버 로그와 디버깅을 보기 쉽다.
- HTTP/WebSocket 기반이라 언어 선택 폭이 넓다.
- MessengerBot 앱 내부 JS 실행 제약에서 일부 벗어날 수 있다.

단점:

- 기존 `main.js`를 바로 실행하기 어렵다.
- `FileStream`, `java.io.*` 같은 API 대체가 필요하다.
- 저장 경로와 운영 데이터 보호 설계가 필요하다.

### B. 기존 MessengerBot 운영환경 유지 + Iris는 별도 실험환경

운영은 기존 LDPlayer/MessengerBot 흐름을 유지하고, Iris는 개발환경 고도화 실험으로 분리한다.

장점:

- 운영 안정성을 유지할 수 있다.
- Iris 전환 리스크를 별도로 검증할 수 있다.

단점:

- 두 실행환경의 차이를 계속 관리해야 한다.
- 동일 명령의 동작 차이를 비교하는 테스트 체계가 필요하다.

### C. hoiBot 코어 로직 분리 후 양쪽 어댑터 제공

장기적으로 명령 처리 핵심 로직을 환경 의존 API에서 분리한다.

```text
MessengerBot adapter -> hoiBot core -> MessengerBot reply
Iris adapter         -> hoiBot core -> Iris /reply
```

장점:

- 장기적으로 테스트 가능성과 이식성이 좋아진다.
- 로컬 테스트 하네스를 만들기 쉬워진다.

단점:

- 현재 `main.js` 규모상 큰 구조 변경이 될 수 있다.
- AGENTS.md 규칙상 대규모 리팩토링은 별도 계획과 단계적 진행이 필요하다.

---

## 9. 현재 확인된 리스크

- Root 권한이 필요할 수 있어 설치/운영 난이도가 높다.
- 카카오톡 DB 구조나 버전 변화에 영향을 받을 수 있다.
- Iris는 베타 상태로 표시되어 있다.
- 카카오톡 약관, 운영 정책, 보안 정책과 충돌할 수 있는 영역이 있으므로 사용 범위를 신중히 정해야 한다.
- hoiBot의 기존 MessengerBot/Rhino API 의존성이 커서 즉시 전환은 어렵다.
- `room` 이름과 실제 답장 대상 `room id/chat_id` 매핑을 명확히 검증해야 한다.
- 기존 `FileStream` 저장 흐름을 서버 환경으로 옮기면 저장 실패/동시성/데이터 보호 문제가 새로 생긴다.
- 최신 카카오톡 일반채팅 유저 정보 암호화 이슈에 Iris가 어느 범위까지 대응되는지 별도 확인이 필요하다.

---

## 9-1. 유사 프레임워크: luna

사용자 제공 자료에서 Iris와 비슷한 프레임워크로 `luna`가 언급되었다.

정리된 특징:

- 제작자는 zzugu님으로 언급된다.
- 최신 카카오톡 일반채팅의 유저 정보 암호화 이슈에 대응되어 있다고 설명된다.
- 메시지 이벤트에 유저 정보를 포함해 전달하므로, Iris처럼 별도 쿼리를 날리는 번거로움이 줄어든다고 한다.
- Iris가 사진 전송 중심으로 설명되는 반면, luna는 파일 전송도 지원한다고 한다.
- GUI 방식으로 서비스를 켜고 끌 수 있고, 기존 Iris 방식이나 broadcast 방식으로 실행할 수도 있다고 한다.

단점으로 언급된 항목:

- 최신 카카오톡 버전에서만 사용 가능
- Iris와 달리 closed source
- Iris에 비해 자료 부족

luna에 대해서는 Python 클라이언트인 `lunapy`를 참고하라는 설명이 있었다.

---

## 10. 다음 조사 과제

- Iris 최신 릴리즈와 설치 파일 구성 확인
- Windows + LDPlayer 또는 Android 기기에서 Iris 설치 가능성 확인
- Android Studio AVD, Android 9 이상 에뮬레이터, redroid 중 hoiBot 개발환경에 맞는 실행 후보 비교
- Root 권한 필요 범위 확인
- `/reply`의 `room` 값이 방 이름인지 chat_id인지 실제 동작 검증
- WebSocket 이벤트의 전체 payload 샘플 확보
- Python `irispy-client` 사용 여부 검토
- `iris_bot` 샘플 봇 구조 확인
- Node.js 서버로 Iris 이벤트를 받아 hoiBot `response(...)` 형태로 변환하는 최소 PoC 설계
- hoiBot 코드에서 `replier`, `Api`, `FileStream`, `java.io.*` 의존 지점 목록화
- 운영 데이터와 개발 데이터의 경로/권한/마스킹 정책 설계
- luna/lunapy가 hoiBot 개발환경 고도화에 더 적합한지 비교 조사

---

## 11. 참고 링크

- Iris GitHub: https://github.com/dolidolih/Iris
- Iris Releases: https://github.com/dolidolih/Iris/releases
- KBotDocs Iris 시작하기: https://kbotdocs.dev/reference/iris/get-started
- KBotDocs Iris 레퍼런스: https://kbotdocs.dev/reference/iris
- KBotDocs irispy-client: https://kbotdocs.dev/reference/irispy-client
- MessengerBot ADB 참고: https://violetxf.gitbook.io/messengerbot/tips/adb
- 사용자 제공 네이버 카페 글: http://cafe.naver.com/devlobots/7597

---

## 12. 영상 자료 취합

사용자가 제공한 YouTube 영상 3개는 별도 문서에 자동자막 기반으로 취합했다.

- `개발환경_고도화/Iris_영상자료_취합.md`

영상별 자동자막 기반 요약, 개발환경 후보 비교, 이미지 추출 후보는 위 문서를 참고한다.
이 문서에서는 중복 정리를 피하고, Iris 전체 정보와 hoiBot 적용 관점만 유지한다.

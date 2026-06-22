# Iris 기반 구현 가능성 검토

## 결론

구현 가능성이 있다.

공식 자료 기준 Iris는 Android에서 실행되는 서버 애플리케이션이며, KakaoTalk 데이터베이스 접근, HTTP 서버, WebSocket 이벤트 전달, reply API를 제공하는 구조다. 따라서 `LDPlayer + KakaoTalk + Iris -> 운영 PC hoiBot Server` 구조는 기술적으로 맞는 방향이다.

다만 성공 여부는 LDPlayer 환경에서 Iris가 KakaoTalk DB와 시스템 서비스에 정상 접근할 수 있는지에 달려 있다.

## 근거

- Iris는 Android 기기에서 실행되도록 설계된 서버 애플리케이션이다.
- Iris 사용 요구사항에는 KakaoTalk이 설치된 Android 환경, Root 권한, Iris와 상호작용할 HTTP 서버가 포함된다.
- Iris는 `/config/endpoint`로 설정한 외부 서버에 메시지 이벤트를 POST할 수 있다.
- Iris는 `/ws` WebSocket endpoint로 메시지 이벤트를 전달할 수 있다.
- Iris는 `/reply` 계열 API를 통해 답장 전송을 제공한다.

참고:

- https://github.com/dolidolih/Iris
- https://kbotdocs.dev/reference/iris
- https://kbotdocs.dev/reference/iris/get-started

## 가능하다고 보는 부분

### 1. 메신저봇R 대체

AS-IS에서 메신저봇R이 하던 역할은 크게 두 가지다.

```text
1. KakaoTalk 메시지 수신
2. main.js / Info.js 실행 후 reply
```

Iris는 메시지 감지와 reply API를 제공하므로, 중간에 adapter를 만들면 같은 역할을 대체할 수 있다.

### 2. 운영 PC 서버 중심화

Iris가 HTTP endpoint와 WebSocket을 지원하므로, 운영 PC에 hoiBot Server를 띄우고 Iris 이벤트를 받을 수 있다.

```text
Iris
-> HTTP POST 또는 WebSocket
-> hoiBot Server
```

### 3. 데이터 위치 이전

기존 JSON 데이터가 LDPlayer 안에 있을 필요는 없다. hoiBot Server가 PC에서 실행되면 데이터도 PC 쪽 DB/파일로 둘 수 있다.

단, 기존 `loadJsonFile` / `saveJsonFile` 흐름은 서버 저장소에 맞게 바꿔야 한다.

### 4. Discord 확장

운영 PC hoiBot Server를 중심으로 만들면 Discord adapter를 같은 서버에 붙일 수 있다.

```text
Iris adapter
Discord adapter
Admin adapter
        |
        v
hoiBot command engine
```

## 위험 요소

### 1. LDPlayer Root/권한 문제

Iris는 KakaoTalk DB 접근을 위해 Android Root 권한이나 시스템 서비스 접근이 필요할 수 있다. LDPlayer의 Root 설정이 충분한지 검증해야 한다.

### 2. KakaoTalk 버전 호환성

KakaoTalk DB 구조나 암호화 방식이 버전에 따라 바뀔 수 있다. Iris가 현재 LDPlayer의 KakaoTalk 버전을 지원하는지 확인해야 한다.

### 3. 기존 main.js 구조

현재 main.js는 메신저봇R/Rhino 환경을 전제로 작성되어 있다. Node.js 서버에서 그대로 실행하기 어려운 부분이 있을 수 있다.

특히 아래 항목은 별도 shim 또는 리팩터링이 필요하다.

- `FileStream`
- `Api.replyRoom`
- Android 전용 객체
- Rhino와 Node.js 문법/동작 차이
- 저장 경로 `/sdcard/호이랜드/`

### 4. 저장 로직 이전

데이터 위치를 LDPlayer 내부 JSON에서 PC 쪽 DB/파일로 바꾸면 save/load 흐름이 가장 큰 리스크가 된다. 초기에 쓰기 명령을 바로 이전하지 말고 읽기 전용 명령부터 검증해야 한다.

## 최소 PoC

아래 순서가 통과되면 구현 가능성이 높다고 판단할 수 있다.

1. LDPlayer에서 Iris.apk 설치
2. Iris dashboard 접속
3. KakaoTalk 테스트방 메시지 감지
4. 운영 PC 서버에서 Iris 이벤트 수신
5. `/ping` 입력 시 `pong` 답장
6. PC 쪽 JSON 파일 하나 읽어서 답장
7. Discord bot에서 같은 `/ping` 명령 호출

## 권장 개발 순서

1. Iris 설치/실행 확인
2. HTTP endpoint 방식으로 이벤트 수신
3. WebSocket 방식 수신도 별도 검증
4. 단순 demo handler 작성
5. `Info.js` 일부 읽기 명령 연결
6. PC 데이터 저장소 설계
7. save/load adapter 설계
8. Discord adapter 추가
9. mutation 명령 점진 이전

## 현재 판단

```text
아키텍처 방향: 가능
Iris 사용: 가능성 높음
LDPlayer 호환성: 검증 필요
기존 main.js 즉시 이식: 위험
점진 이전: 권장
Discord 확장: 서버 중심화 후 가능
```

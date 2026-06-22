# Iris 전환 검증 체크리스트

현재 운영 PC에는 LDPlayer, KakaoTalk, 메신저봇R이 이미 설치되어 있다.

목표는 기존 메신저봇R 운영을 바로 대체하는 것이 아니라, Iris가 같은 LDPlayer 환경에서 TO-BE 구조로 동작 가능한지 단계적으로 확인하는 것이다.

## 0. 안전 기준

- [ ] 운영 중인 메신저봇R 설정과 봇 파일을 백업한다.
- [ ] 테스트는 운영방이 아니라 별도 테스트방에서 먼저 진행한다.
- [ ] 봇 계정 로그인 상태를 확인한다.
- [ ] 현재 LDPlayer 인스턴스 이름 또는 번호를 기록한다.
- [ ] 현재 KakaoTalk 버전을 기록한다.
- [ ] 현재 메신저봇R 버전을 기록한다.

## 1. LDPlayer 접근 확인

- [ ] LDPlayer가 실행 중인지 확인한다.
- [ ] LDPlayer Root 권한 설정 상태를 확인한다.
- [ ] LDPlayer ADB 디버깅 설정 상태를 확인한다.
- [ ] 운영 PC에서 `adb devices`로 LDPlayer가 `device` 상태인지 확인한다.
- [ ] ADB로 LDPlayer 내부 파일 목록을 조회할 수 있는지 확인한다.

## 2. Iris 설치 준비

- [ ] 공식 GitHub Releases에서 `Iris.apk`를 다운로드한다.
- [ ] 필요하면 `iris_control.ps1`도 참고용으로 다운로드한다.
- [ ] `Iris.apk` 파일의 보관 위치를 기록한다.
- [ ] 기존 메신저봇R과 충돌 가능성이 있는지 확인한다.

## 3. Iris 설치/실행 확인

- [ ] ADB로 `Iris.apk`를 LDPlayer에 설치하거나 `/data/local/tmp`에 배치한다.
- [ ] Iris를 실행한다.
- [ ] Iris dashboard 또는 상태 API에 접근 가능한지 확인한다.
- [ ] Iris가 KakaoTalk 설치 상태를 인식하는지 확인한다.

## 4. KakaoTalk 메시지 감지 PoC

- [ ] 테스트방에 메시지를 보낸다.
- [ ] Iris가 메시지를 감지하는지 확인한다.
- [ ] 감지된 이벤트에 `msg`, `room`, `sender`, `json.chat_id`가 포함되는지 확인한다.
- [ ] WebSocket `/ws`로 같은 이벤트를 받을 수 있는지 확인한다.
- [ ] HTTP endpoint 방식으로도 이벤트를 받을 수 있는지 확인한다.

## 5. Reply PoC

- [ ] Iris reply API로 테스트방에 텍스트 답장을 보낸다.
- [ ] thread 또는 room 식별자가 필요한지 확인한다.
- [ ] 답장 실패 시 에러 메시지와 요청 payload를 기록한다.

## 6. 운영 PC hoiBot Server PoC

- [ ] 운영 PC에서 간단한 HTTP 서버를 실행한다.
- [ ] Iris endpoint를 운영 PC 서버로 설정한다.
- [ ] `/ping` 메시지를 받아 `pong`으로 답장한다.
- [ ] WebSocket 수신 방식도 별도로 검증한다.

## 7. 데이터 위치 이전 PoC

- [ ] PC 쪽 테스트 데이터 폴더를 정한다.
- [ ] LDPlayer 내부 JSON을 직접 쓰지 않는 읽기 테스트를 만든다.
- [ ] PC 쪽 JSON/DB에서 값을 읽어 KakaoTalk으로 답장한다.
- [ ] 쓰기 명령은 읽기 검증 후 별도 단계로 진행한다.

## 8. 기존 hoiBot 로직 연결

- [ ] `Info.js`의 읽기 전용 명령 하나를 adapter로 호출한다.
- [ ] `main.js`는 바로 전체 이식하지 않고, 의존성 목록을 먼저 뽑는다.
- [ ] `FileStream`, `Api.replyRoom`, Android 전용 객체 의존을 분리한다.
- [ ] 저장/포인트/아이템 변경 명령은 마지막 단계로 미룬다.

## 9. Discord 확장 PoC

- [ ] Discord bot을 같은 hoiBot Server에 붙일 수 있는 구조인지 확인한다.
- [ ] Discord에서 `/ping` 또는 테스트 명령을 실행한다.
- [ ] KakaoTalk과 Discord가 같은 command engine을 공유하는지 확인한다.

## 10. 운영 자동화

- [ ] 운영 PC에서 Git pull 절차를 정한다.
- [ ] Iris 시작/중지/상태확인 방식을 정한다.
- [ ] hoiBot Server 시작/중지/재시작 방식을 정한다.
- [ ] 장애 시 로그 위치와 복구 순서를 문서화한다.

# Iris 개발 PC 선행 검증 결과

검증일: 2026-07-30

## 검증 목적

기존 MessengerBot R 운영환경을 변경하지 않고, 개발 PC의 LDPlayer 9에서 Iris가 KakaoTalk 이벤트를 hoiBot Lite 서버로 전달할 수 있는지 확인했다.

이번 검증은 TO-BE 구조의 메시지 수신 경로와 이벤트 식별 방식에 대한 선행 PoC다. 운영 PC 반영, Iris 답장 API, 기존 hoiBot 명령 연결, 데이터 이전은 포함하지 않았다.

## 검증 구성

```text
개발 PC LDPlayer 9
-> KakaoTalk 테스트방
-> Iris HTTP endpoint
-> 개발 PC runtime/ hoiBot Lite server
```

- Lite 서버 버전: `0.1.0`
- 수신 경로: `POST /api/v1/integrations/iris/events`
- LDPlayer에서 확인한 개발 PC 게이트웨이: `172.16.1.2`
- 인증 방식: Iris endpoint 쿼리 토큰
- 원본 이벤트 확인 방식: 서버 구조화 로그와 인증된 최근 이벤트 조회 API

게이트웨이 주소는 LDPlayer 네트워크 설정에 따라 바뀔 수 있으므로 운영 PC에서는 다시 확인해야 한다.

## Lite 서버 구현 및 자동 검증

`runtime/`에 다음 기반을 구성했다.

- health, ready, ping, version API
- Iris HTTP 이벤트 수신 API
- Bearer, `x-iris-token`, 쿼리 토큰 인증
- UUID 기반 요청 식별자와 `x-request-id` 응답 헤더
- 1MiB 기본 body 제한
- 개발용 최근 이벤트 메모리 저장소
- 인증 토큰을 가린 구조화 로그
- 정상 종료 처리와 가짜 Iris 이벤트 전송 스크립트

자동 테스트는 다음 항목을 다룬다.

- health 응답과 요청 식별자
- ping/pong 응답
- 토큰 없는 Iris 요청의 401 거부
- 인증된 이벤트의 202 수락과 최근 이벤트 저장
- Iris 호환 쿼리 토큰
- 설정 크기를 넘긴 payload의 413 거부

## 실제 Iris 수신 결과

서버 로그 집계 결과는 다음과 같다.

| 항목 | 결과 |
| --- | ---: |
| 전체 구조화 로그 | 6,191줄 |
| HTTP 요청 수신/완료 | 각 2,068건 |
| Iris 이벤트 요청 | 2,050건 |
| Iris 이벤트 202 응답 | 2,050건 |
| health 및 최근 이벤트 조회 200 응답 | 17건 |
| 의도적으로 잘못 호출한 `/health` 404 | 1건 |
| 원본 payload 구조화 로그 | 488건 |

Iris에서 Lite 서버까지 HTTP 이벤트가 지속적으로 전달되고, 서버가 수신 요청을 정상 수락하는 것을 확인했다.

## 이벤트 표본 분석

개인정보를 제외한 표본 7건, 논리 시나리오 4개를 분석했다.

- 공통 payload에서 `msg`, `room`, `sender`, `json`을 확인했다.
- `json` 안에서 메시지·방·사용자 식별에 필요한 `_id`, `id`, `chat_id`, `user_id` 등을 확인했다.
- 숫자로 보이는 외부 식별자는 정밀도 손실을 막기 위해 문자열로 저장해야 한다.
- 동일 카카오 계정의 프로필 조건 비교 결과, 외부 사용자 식별은 `provider + context + user_id` 조합을 후보로 두는 것이 안전하다.
- 내부 사용자는 서버가 발급한 UUID를 기본 키로 두고 외부 식별자와 분리하는 방향을 권장한다.

## 연속 메시지와 중복 전달 확인

같은 계정에서 연속으로 보낸 메시지 3건을 비교했다.

- 수신 건수: 3건
- 서로 다른 `requestId`: 3개
- 서로 다른 Iris JSON 메시지 ID: 3개
- 서로 다른 행 ID: 3개
- 동일 HTTP 이벤트의 중복 전달: 확인되지 않음

현재 표본에서는 각 실제 메시지가 별도 이벤트로 한 번씩 전달됐다. 재시도나 네트워크 장애 상황의 중복 가능성은 별도 검증이 필요하므로, 서버 측 멱등 처리 설계는 유지해야 한다.

## 삭제 이벤트 확인

원본 메시지와 삭제 이벤트를 비교해 삭제 감지를 확인했다.

- 이벤트 분류: `message-delete`
- 외부 `type`: `0`
- feed type: `14`
- origin: `SYNCDLMSG`
- hidden: `true`
- 원본 메시지와 삭제 이벤트 연결 확인: 성공
- 관측된 삭제 감지 지연: 약 2.815초

삭제 이벤트는 일반 메시지와 구조가 다르므로, 향후 Iris adapter에서 별도 이벤트로 정규화해야 한다.

## 보안 및 기록 원칙

- 실제 방 이름, 발신자, 메시지, 카카오 식별자가 포함된 원본 JSON과 서버 로그는 Git에 커밋하지 않는다.
- `runtime/.env`, `runtime/logs/`, `runtime/node_modules/`, `runtime/dist/`는 Git 추적에서 제외한다.
- 공유 토큰은 저장소에 넣지 않고 운영 환경 변수로만 제공한다.
- 운영에서는 원본 payload 로깅과 최근 이벤트 조회를 기본 비활성화하고, HTTPS 또는 사설망과 방화벽/IP 제한을 추가한다.

## 확인된 결론

- 개발 PC의 LDPlayer 9에서 Iris HTTP 이벤트 수신 경로는 동작한다.
- hoiBot Lite 서버가 인증된 Iris 이벤트를 안정적으로 수락할 수 있다.
- 메시지, 계정 비교, 연속 메시지, 삭제 이벤트의 기본 구조를 확인했다.
- 기존 MessengerBot R 운영 파일과 LDPlayer의 hoiBot JSON 데이터는 변경하지 않았다.

## 아직 확인하지 않은 항목

- 운영 PC에서 같은 구성 재현
- Iris WebSocket `/ws` 수신
- Iris `/reply`를 이용한 KakaoTalk 답장
- `/ping` 입력부터 `pong` 답장까지의 전체 왕복
- PC 데이터 파일 또는 DB 읽기/쓰기
- 기존 `Info.js` 읽기 전용 명령 연결
- 네트워크 장애·Iris 재시도 시 중복 이벤트 처리
- 장시간 실행, 재시작, 로그 순환, 프로세스 자동 복구

## 다음 권장 순서

1. 운영 PC 환경값과 백업 상태를 기록한다.
2. 별도 테스트방에서 운영 PC Iris HTTP 수신을 재검증한다.
3. `/reply`를 이용한 단순 ping/pong 왕복을 검증한다.
4. WebSocket 수신과 HTTP 수신의 차이를 비교한다.
5. 이벤트 정규화 및 멱등 키 정책을 설계한다.
6. `Info.js`의 읽기 전용 명령 하나를 adapter로 연결한다.
7. PC 데이터 저장소를 설계한 뒤 쓰기 명령을 마지막에 이전한다.

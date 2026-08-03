# hoiBot 고도화 대화 메모리

최종 갱신일: 2026-08-03

이 문서는 새 대화 세션이 현재 작업을 이어받기 위한 최신 상태 스냅샷이다.
대화 전문이나 세션별 누적 로그를 저장하지 않고, 실행에 필요한 현재 맥락만 유지한다.
확정 결정은 `DECISIONS.md`를 따르며 이 문서에서 다시 결정하지 않는다.

## 현재 목표

- Iris를 hoiBot의 KakaoTalk 입출력 계층으로 사용해 고도화한다.
- PC/redroid 환경에서 KakaoTalk + Iris 연결 상태를 단계적으로 검증한다.
- TypeScript/Node.js 24 LTS/Fastify 5 기반 hoiBot Server로 기존 게임 로직을 점진적으로 이전한다.
- 전환 우선순위는 `ASAP`이며 구현과 검증이 완료된 기능부터 가능한 한 빠르게 순차 전환한다.
- 기존 운영을 즉시 변경하지 않고 별도 테스트 흐름에서 입력·응답·저장 경로를 먼저 확인한다.

## 현재 진행 위치

- PC/redroid 구성과 기준 영상이 확정됐다.
- hoiBot Server 구현 스택이 확정됐다.
- `runtime/`에 Fastify 기반 Lite 서버와 Iris HTTP 이벤트 수신 API가 존재한다.
- 고도화 문서는 결정, 대화 메모리, 정보성 참조자료로 분리됐다.
- 최신 `feature/prod`의 `4f00533`에서 `feature/modernization` 브랜치를 생성했다.
- 고도화 전용 작업공간은 `C:\Users\user\Desktop\hoiBot_modernization`이다.

## 확인된 현상

- 사용자가 redroid 환경이 현재 실행 중이라고 확인했다.
- 저장소의 Lite 서버에는 health, ready, ping, version 및 Iris 이벤트 수신 기반이 구현돼 있다.

## 미검증 항목

- redroid 내부 KakaoTalk과 Iris의 현재 상세 상태
- Iris HTTP 이벤트의 redroid 환경 실수신
- Iris WebSocket `/ws` 수신
- Iris `/reply`를 이용한 KakaoTalk 답장
- `/ping` 입력부터 `pong` 답장까지의 전체 왕복
- redroid 재시작 후 데이터와 설정 유지
- hoiBot Server와 PC 데이터 저장소 연결

## 열린 질문

- hoiBot Server를 Windows 호스트와 Ubuntu/Linux VM 중 어디에서 상시 실행할지
- PC 데이터 저장소의 DB 종류와 백업·복구 방식
- 기존 JSON 데이터를 이전할 순서와 읽기 전용 첫 명령

## 다음 작업

1. 다음 고도화 작업을 `feature/modernization` 브랜치에서 시작한다.
2. redroid와 Iris의 현재 프로세스·포트·ADB 연결 상태를 읽기 전용으로 확인한다.
3. 별도 테스트방에서 Iris HTTP 이벤트 수신을 검증한다.
4. Iris `/reply`로 단순 ping/pong 왕복을 검증한다.
5. WebSocket `/ws` 수신을 검증한다.
6. 검증 결과를 메모리에 반영하고 필요한 경우 별도 결과 문서를 작성한다.

## 최근 대화 요약

- 고도화 방향을 YouTube 기준의 PC + redroid 환경으로 확정했다.
- 선택되지 않은 다른 실행환경 기술스택은 문서에서 제거했다.
- hoiBot Server 구현 스택을 TypeScript + Node.js 24 LTS + Fastify 5로 확정했다.
- 대화 메모리와 확정 결정 문서를 분리하기로 했다.
- 고도화 작업을 별도 `feature/modernization` 브랜치에서 진행하기로 했다.
- hoiBot을 Iris 기반으로 고도화하기로 확정했다.
- 전환 우선순위를 `ASAP`으로 확정했다.

## 갱신 규칙

1. 의미 있는 고도화 세션 종료 시 이 문서를 최신 상태로 갱신한다.
2. 완료된 항목은 미검증 목록에서 제거하고 확인된 현상 또는 진행 위치에 반영한다.
3. 오래된 진행 맥락과 다음 작업은 현재 상태로 교체하며 세션별로 누적하지 않는다.
4. 사용자 결정이 필요한 내용은 열린 질문에 두고 `DECISIONS.md`에 먼저 기록하지 않는다.
5. 토큰, 카카오톡 원문, 계정정보, 개인정보는 기록하지 않는다.

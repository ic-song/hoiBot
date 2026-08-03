# hoiBot 고도화 확정 결정

최종 갱신일: 2026-08-03

이 문서는 hoiBot 고도화에서 사용자가 명시적으로 확정한 결정의 단일 기준이다.
`MEMORY.md` 또는 `references/` 문서와 내용이 충돌하면 이 문서를 우선한다.

## 관리 규칙

1. 사용자가 명시적으로 확정한 내용만 등록한다.
2. 추천, 추측, 검토안, 미검증 내용은 등록하지 않는다.
3. 결정을 변경할 때 기존 기록을 삭제하거나 조용히 덮어쓰지 않는다.
4. 기존 결정은 `SUPERSEDED`로 바꾸고 대체 결정 ID와 변경일을 기록한다.
5. 현재 적용할 결정은 `ACTIVE` 상태만 사용한다.

## 활성 결정

### DEC-001: PC redroid 실행환경

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: hoiBot 고도화 실행환경은 PC의 redroid 구성만 사용한다.
- 구성: `Windows -> Hyper-V -> Ubuntu/Linux VM -> Docker -> redroid -> KakaoTalk + Iris`
- 근거: 사용자가 PC에서 redroid를 사용한다고 확인하고 해당 구성을 고도화 방향으로 확정했다.
- 적용 범위: 실행환경 설계, 설치, 테스트, 운영 전환 계획

### DEC-002: 기준 영상

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: YouTube `Iris를 이용한 봇 만들기`를 PC/redroid 환경 구성의 기준 영상으로 사용한다.
- 링크: https://www.youtube.com/watch?v=H43VTOsKDXY
- 적용 범위: Hyper-V, Linux, Docker, redroid, Iris 설치 흐름

### DEC-003: hoiBot Server 구현 스택

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: hoiBot Server는 `TypeScript + Node.js 24 LTS + Fastify 5`로 구현한다.
- 근거: 기존 JavaScript 게임 로직과 `개발환경_고도화/runtime/`의 TypeScript/Fastify 서버 기반을 점진적으로 재사용한다.
- 적용 범위: HTTP/WebSocket 서버, Iris adapter, 명령 처리, 서버 측 데이터 접근 계층

### DEC-004: 고도화 문서 관리 범위

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: 고도화 관련 메모리와 문서는 `개발환경_고도화/` 내부에서만 관리한다.
- 결정: 기술/API 및 조사성 정보는 `references/` 아래의 영문 Markdown으로 관리한다.
- 적용 범위: 세션 메모리, 결정 기록, 기술 참고자료, 검증 결과

### DEC-005: 고도화 전용 브랜치

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: 고도화 관련 문서, 서버, redroid/Iris 연동 작업은 `feature/modernization` 브랜치에서만 진행한다.
- 기준: 새 작업을 시작하기 전에 최신 `feature/prod`를 확인하고 `feature/modernization`에 반영한다.
- 운영 반영: 고도화 변경은 사용자가 명시적으로 요청한 경우에만 검증된 커밋을 `feature/prod`에 반영한다.
- 적용 범위: `개발환경_고도화/` 내부의 문서, `runtime/`, 향후 hoiBot Server 및 adapter 구현

### DEC-006: Iris 기반 고도화

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: hoiBot은 Iris를 사용해 고도화한다.
- 역할: Iris는 redroid 안에서 KakaoTalk 메시지 감지와 답장 전송을 담당한다.
- 역할: hoiBot Server는 Iris의 HTTP/WebSocket 이벤트를 받아 명령과 게임 로직을 처리하고 Iris `/reply`로 응답한다.
- 전환 시점: `ASAP`. 별도 일정까지 기다리지 않고 구현과 검증이 완료된 기능부터 가능한 한 빠르게 순차 전환한다.
- 적용 범위: KakaoTalk 입출력 adapter, 이벤트 정규화, 응답 전송, 기존 MessengerBot 의존 로직의 점진적 이전

### DEC-007: 고도화 검증 및 구현 순서

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: 서버 본구현보다 redroid/Iris 클라이언트의 실제 연동 검증을 먼저 수행한다.
- 1단계: redroid 안의 KakaoTalk + Iris에서 테스트 명령을 보내 hoiBot Server와 연결 및 기본 왕복을 확인한다.
- 2단계: 일반 메시지뿐 아니라 Iris가 제공하는 각종 이벤트와 부가 데이터가 서버로 전송되는지 확인하고 실제 수신 범위를 기록한다.
- 3단계: 1~2단계에서 확인한 실제 payload와 제약을 기준으로 hoiBot Server를 구현한다.
- 적용 범위: redroid/Iris 연동 검증, 이벤트·payload 조사, hoiBot Server 구현 착수 기준

### DEC-008: `/ping` 감지 검증 상한

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: 앞으로 `/ping` 반복 감지 검증은 서로 다른 이벤트 10건까지만 집계하고 10건 확인 즉시 종료한다.
- 적용 범위: 연결 안정성 확인, 반복 감지 시험, 검증 결과 보고

### DEC-009: `/ping` 서버 연결 확인 응답

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: KakaoTalk에서 정확히 `/ping`을 입력하면 Iris가 hoiBot Server로 이벤트를 전달하고 서버는 같은 방에 `발신자이름 pong`으로 답한다.
- 실행 조건: 메시지 전체가 `/ping`과 정확히 일치해야 하며 추가 문자가 붙은 입력은 실행하지 않는다.
- 적용 범위: redroid/Iris/hoiBot Server 연결 확인 명령

### DEC-010: hoiBot Server 프로젝트 위치

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: 고도화용 Node.js hoiBot Server 프로젝트는 `개발환경_고도화/runtime/` 내부에서만 관리한다.
- 근거: 고도화 관련 파일을 `개발환경_고도화/` 내부에 격리한다.
- 적용 범위: 서버 소스, 패키지 설정, 테스트, 실행 문서와 로컬 런타임 설정

## 대체된 결정

현재 없음.

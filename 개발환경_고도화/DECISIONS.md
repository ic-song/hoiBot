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
- 근거: 기존 JavaScript 게임 로직과 `runtime/`의 TypeScript/Fastify 서버 기반을 점진적으로 재사용한다.
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
- 적용 범위: `개발환경_고도화/`, `runtime/`, 향후 hoiBot Server 및 adapter 구현

## 대체된 결정

현재 없음.

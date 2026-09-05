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

### DEC-005: 포털·게임계정·플랫폼 관계와 인증

- 결정일: 2026-09-04
- 상태: `ACTIVE`
- 결정: 포털계정과 게임계정은 `1:N`이며 최초 연결 게임계정은 대표계정, 이후 연결 게임계정은 부계정이다.
- 결정: 플랫폼 사용자는 방·서버별로 활성 게임계정을 최대 하나 선택하고 `/계정변경` 이후 명령은 선택된 `player_id` 기준으로 실행한다.
- 결정: KakaoTalk 오픈채팅은 방별 사용자키이므로 방마다 최초 인증하고, Discord는 계정 ID를 여러 서버에서 공유하되 활성계정은 서버별로 관리한다.
- 결정: 신규 회원은 포털계정 생성 후 `/인증` 성공 시 신규 게임계정을 만들고, 레거시 회원은 기존 게임계정과 데이터를 보존한 채 포털계정에 동기화한다.
- 결정: 인증 시 입력 닉네임과 플랫폼의 현재 닉네임을 확인하되 닉네임은 식별키로 사용하지 않는다.
- 적용 범위: 회원가입, 기존회원 동기화, 플랫폼 연결, 대표·부계정, 명령 actor 결정, DB schema와 WBS
- 상세 기준: `ACCOUNT_PLATFORM_DATA_MODEL_STANDARD.md`

## 대체된 결정

현재 없음.

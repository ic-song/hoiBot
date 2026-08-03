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

### DEC-011: Iris 이벤트 정보와 서버 매핑 분리

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: Iris 이벤트의 실제 검증 근거와 hoiBot Server 구현용 매핑 정보를 별도 파일로 관리한다.
- 검증 기준: `references/IRIS_EVENT_CAPABILITY_MATRIX.md`
- 서버 구현 참고: `references/IRIS_SERVER_EVENT_MAPPING.json`
- 관리 원칙: 실관측·원본 코드·DB 근거가 없는 항목은 `unverified` 또는 `not_direct` 상태로 유지한다.
- 적용 범위: Iris adapter, 이벤트 정규화, 명령 처리 전처리와 향후 테스트 설계

### DEC-012: 수신 이미지 테스트방 전달

- 결정일: 2026-08-03
- 상태: `SUPERSEDED`
- 대체 결정: `DEC-013` (2026-08-03)
- 결정: Iris에서 단일 이미지가 수신되면 `/ping` 연결을 검증한 테스트방으로 전달한다.
- 실행 조건: `type=2`, `isMine=false`인 수신 이벤트만 처리하며 대상 방 ID는 코드나 문서가 아닌 실행 환경에서 관리한다.
- 안전 범위: Kakao CDN HTTPS 이미지, 설정된 용량·시간 제한을 통과한 경우만 전달한다. 다중 이미지는 별도 실검증 전까지 제외한다.
- 적용 범위: hoiBot Lite Server의 Iris 이미지 수신·전달 검증

### DEC-013: 지정 계정 이미지 테스트방 전달

- 결정일: 2026-08-03
- 상태: `SUPERSEDED`
- 대체 결정: `DEC-014` (2026-08-03)
- 결정: 카카오톡 계정이 하나인 현재 테스트 환경에서는 사용자가 직접 보낸 단일 이미지만 `/ping` 테스트방으로 전달한다.
- 식별 조건: `/ping`을 보낸 계정의 `user_id`가 일치하는 이미지만 처리하며 ID는 코드나 문서가 아닌 실행 환경에서 관리한다.
- 반복 방지: 테스트방에서 감지된 이미지는 다시 전달하지 않는다. 따라서 같은 계정의 전송 이벤트가 `isMine=true`여도 다른 방에서 발생한 경우 처리할 수 있다.
- 안전 범위: Kakao CDN HTTPS 이미지, 설정된 용량·시간 제한을 통과한 경우만 전달한다. 다중 이미지는 별도 실검증 전까지 제외한다.
- 적용 범위: hoiBot Lite Server의 단일 계정 이미지 전달 검증

### DEC-014: 모든 단일 이미지 테스트방 전달

- 결정일: 2026-08-03
- 상태: `SUPERSEDED`
- 대체 결정: `DEC-015` (2026-08-03)
- 결정: Iris가 감지한 모든 방의 단일 이미지를 `/ping` 테스트방으로 전달한다.
- 반복 방지: 테스트방에서 감지된 이미지는 다시 전달하지 않는다.
- 안전 범위: Kakao CDN HTTPS 이미지, 설정된 용량·시간 제한을 통과한 경우만 전달한다. 다중 이미지는 별도 실검증 전까지 제외한다.
- 적용 범위: hoiBot Lite Server의 단일 이미지 전달 검증

### DEC-015: 이미지 자동 전송 OFF

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: Iris 이미지 감지는 유지하되 테스트방 자동 전송은 끈다.
- 실행 상태: `IRIS_IMAGE_FORWARD_ROOM_ID`를 설정하지 않은 상태로 서버를 실행한다.
- 재활성화: 사용자가 이미지 전송 ON을 명시적으로 요청할 때만 대상 테스트방을 다시 설정한다.
- 적용 범위: hoiBot Lite Server 이미지 자동 전달 기능

### DEC-016: hoiBot Server 전용 DB

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: redroid KakaoTalk DB와 별개인 hoiBot Server 전용 데이터베이스로 MariaDB를 사용한다.
- 역할: 기존 `/sdcard/호이랜드/` JSON에 저장된 게임·운영 데이터를 서버 측 MariaDB로 점진적으로 이전한다.
- 분리 원칙: redroid KakaoTalk DB는 Iris 이벤트·조회 원본이며 hoiBot 게임 데이터 저장소로 사용하지 않는다.
- 미확정: MariaDB 배치 위치, Node.js 드라이버/쿼리 계층, 스키마, 마이그레이션, 백업·복구 방식은 후속 설계에서 정한다.
- 적용 범위: hoiBot Server 영속성, 데이터 이전, 트랜잭션과 백업 설계

### DEC-017: PC 간 동일 환경 재현 목표

- 결정일: 2026-08-03
- 상태: `ACTIVE`
- 결정: 집 PC에서 먼저 구축·검증한 고도화 환경을 이후 운영 PC에도 같은 구조로 쉽게 구성할 수 있어야 한다.
- 관리 원칙: 공통 구성·스크립트·마이그레이션은 저장소에서 관리하고, PC별 주소·토큰·비밀번호·식별자와 운영 데이터는 Git 밖에서 관리한다.
- 적용 범위: Windows/Hyper-V/Linux/Docker/redroid/Iris/hoiBot Server/MariaDB 설치, 검증, 백업·복구 절차

## 대체된 결정

`DEC-012`, `DEC-013`, `DEC-014`는 후속 이미지 전달 결정으로 대체됐다.

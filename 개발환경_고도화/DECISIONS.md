# hoiBot 고도화 확정 결정

최종 갱신일: 2026-08-04

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
- 상태: `SUPERSEDED`
- 대체 결정: `DEC-021` (2026-08-04)
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

### DEC-018: hoiBot Server 상시 실행

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: hoiBot Server는 수동 필요 시 실행이 아니라 상시 실행되도록 구성한다.
- 관리 원칙: 현재 PC에서는 자동 시작과 장애 재시작을 적용하고, 최종 운영 배치가 확정되면 동일 요구사항을 Windows 작업 스케줄러 또는 Linux/Docker 서비스 관리 방식으로 재현한다.
- 적용 범위: Node.js 서버 시작, 장애 복구, PC 재부팅 후 자동 실행

### DEC-019: 중앙 서버와 외부 관리·연동 확장

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: 기존 JavaScript + JSON 기반 hoiBot 기능과 데이터를 hoiBot Server로 점진적으로 이전한다.
- 관리 기능: 별도 관리 홈페이지에서 hoiBot Server API를 통해 게임·운영 데이터를 조회하고 변경할 수 있어야 한다.
- 외부 연동: Discord 및 기타 외부 API를 동일한 hoiBot Server의 연동 계층을 통해 연결할 수 있어야 한다.
- 경계 원칙: 관리 홈페이지와 외부 연동은 MariaDB에 직접 접속하지 않고, 인증·권한·검증·감사 기록을 적용한 서버 API를 사용한다.
- 적용 범위: 서버 모듈 경계, MariaDB 스키마, 관리자 API, 관리 홈페이지, Discord 및 외부 API adapter, 기존 JSON 데이터 이전

### DEC-020: 기존 JSON 기반 확장형 RDB 설계

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: MariaDB 스키마는 현재 hoiBot JSON 데이터와 실제 저장 흐름을 기준으로 설계하되, JSON 파일별 복제 테이블이 아니라 확장 가능한 도메인별 관계형 모델로 구성한다.
- 식별 원칙: 닉네임 대신 내부 식별자를 기준으로 하고 KakaoTalk, Discord, 관리자 계정 및 기타 외부 식별자는 별도 매핑한다.
- 데이터 원칙: 재화·아이템·소유권 변경은 트랜잭션과 원장·감사 기록을 적용하며, JSON 컬럼은 과도기 데이터 또는 구조가 실제로 가변적인 메타데이터에만 제한한다.
- 공통화 원칙: 코드에 하드코딩된 공유 상태·유형·사유 코드는 공통코드로, 속성과 관계가 있는 아이템·스킬·재화 등은 전용 도메인 카탈로그로, 운영 중 조정할 수 있는 제한·확률·보상은 검증·버전·적용시점을 갖는 설정으로 분리한다.
- 적용 범위: 기존 JSON 분석, MariaDB 논리·물리 설계, 데이터 이전, 관리 홈페이지와 외부 연동 확장

### DEC-021: 별도 환경 완성 후 Iris 일괄 운영 전환

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: 기능 구현과 검증은 `feature/modernization`의 별도 테스트 환경에서 수직 기능 단위로 진행하되, 운영 전환은 전체 기능 검증 후 기존 Rhino를 중단하고 Iris 서버로 일괄 수행한다.
- 전환 절차: 최종 JSON 스냅샷과 checksum 생성, Rhino 변경 동결, MariaDB import/reconciliation, Rhino 중단, Iris 연결, 읽기 전용 smoke, mutation 일괄 활성화 순서로 진행한다.
- 롤백: mutation 활성화 전에는 JSON/Rhino로 복귀할 수 있다. mutation 활성화 후에는 이전 서버 이미지 또는 MariaDB backup/point-in-time 복구만 사용하며 오래된 JSON으로 역전환하지 않는다.
- 적용 범위: 구현 순서, 테스트 환경, 운영 전환, 롤백

### DEC-022: 서버 애플리케이션·DB 접근 구조

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: 서버 구조는 `Controller/Adapter -> Application Service -> Domain Policy -> Repository -> MariaDB`로 구성한다.
- DB 접근: MariaDB Connector와 파라미터 SQL을 사용하고 ORM은 도입하지 않는다.
- 경계 원칙: Iris, 관리자 홈페이지, Discord와 외부 API는 동일한 Application Service를 사용한다.
- 적용 범위: hoiBot Server 모듈, 트랜잭션, API와 외부 adapter

### DEC-023: 첫 수직 기능과 관리자 기반

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: 첫 읽기 수직 기능은 기존 출력 전체를 재현하는 KakaoTalk `/내정보`이며, 첫 변경 기능은 관리자 `/서버이동`이다.
- 관리 순서: 관리자 API를 먼저 구현하고 관리 화면은 React + Vite SPA로 후속 구축한다.
- 인증: 첫 관리 기능은 로컬 운영자 계정, Argon2id 비밀번호, DB 세션과 RBAC를 사용한다. 일반 사용자 HTTP 로그인은 이번 범위에서 제외한다.
- 적용 범위: profile read model, 관리자 인증·조회·서버 변경 API, 관리 홈페이지

### DEC-024: 재현 가능한 최종 배치

- 결정일: 2026-08-04
- 상태: `ACTIVE`
- 결정: 기본 운영 배치는 Hyper-V Ubuntu의 Docker Compose에 hoiBot Server와 MariaDB를 함께 배치하고 redroid는 별도 service boundary로 유지한다.
- 재현 기준: 집 PC와 운영 PC는 동일 image digest, migration version과 `.env` key contract를 사용한다.
- 적용 범위: Docker image, Compose, 백업·복구와 PC 간 재구축

## 대체된 결정

`DEC-006`은 `DEC-021`로 대체됐다. `DEC-012`, `DEC-013`, `DEC-014`는 후속 이미지 전달 결정으로 대체됐다.

# New PC Environment Bootstrap Prompt

## Purpose

Copy the prompt below into a new Codex task after cloning the hoiBot repository on a new Windows PC. It instructs Codex to reproduce the currently verified modernization development environment without copying secrets or production data.

## Copy-paste prompt

```text
hoiBot 신규 개발 PC를 현재 고도화 개발 환경과 동일하게 구성해줘.

작업 저장소를 먼저 찾고, 반드시 `feature/modernization` 브랜치에서만 작업해. 고도화 관련 파일은 `개발환경_고도화/` 내부에서만 생성·수정해. 작업 시작 전 저장소 루트의 `AGENTS.md`를 전부 읽고, 이어서 `개발환경_고도화/DECISIONS.md` → `개발환경_고도화/MEMORY.md` 순서로 전부 읽어. 문서와 코드가 충돌하면 `DECISIONS.md`, 현재 코드, `MEMORY.md` 순으로 판단해.

목표는 아래의 현재 검증용 개발 배치를 신규 Windows PC에 재현하는 것이다.

- Windows 11 + Hyper-V/WSL2 기반
- Docker Desktop
- redroid 안의 KakaoTalk + Iris
- redroid ADB: TCP 5555
- Iris HTTP API: 3000
- hoiBot Server: TypeScript + Node.js 24 LTS + Fastify 5, Windows 일반 `node.exe` 프로세스, API 3002
- MariaDB 11.8.8: Docker Compose, Windows loopback 3308, Docker named volume 사용
- 호이월드 사용자·관리자 웹: React + Vite, 5175
- 작업 브랜치: `feature/modernization`

중요한 안전 규칙:

1. 기존 PC의 `.env`, 토큰, 비밀번호, room/user ID, DB dump, KakaoTalk 데이터, 미디어 파일을 Git에서 찾거나 복사하려 하지 마.
2. `.env.example`만 기준으로 새 `.env`를 만들고 비밀값은 새 난수로 생성하거나 내 입력을 받아. 비밀값은 화면·로그·Git diff에 출력하지 마.
3. `data/*.json`은 읽기 전용 legacy snapshot으로 취급하고 수정하지 마.
4. 운영 데이터 import, `feature/prod` 반영, `main` 반영, 실제 운영방 연결은 하지 마.
5. 포트가 사용 중이면 임의의 다른 포트를 고르지 말고 충돌 프로세스와 영향 범위를 알려줘. 기본 포트는 Iris 3000, API 3002, MariaDB 3308, Vite 5175다.
6. KakaoTalk의 16자리 이상 ID는 항상 문자열로 다뤄.
7. Iris `sender`와 `room`은 미신뢰 캐시다. 인증·권한·소유권 근거로 사용하지 마.
8. 삭제·수정 원문이나 실제 메시지 본문을 진단 로그·Markdown·Git에 기록하지 마.
9. 기존 로컬 변경이 있으면 보존하고, 덮어쓰기·reset·checkout으로 제거하지 마.

다음 순서로 실제 설치와 검증을 진행해.

1. 현재 PC 상태 조사
   - Windows 버전, 가상화, Hyper-V/WSL2, Docker Desktop, Git, Node.js, npm, ADB 설치 여부를 확인해.
   - `3000`, `3002`, `3308`, `5175`, `5555`의 점유 상태를 확인해.
   - 누락된 필수 프로그램만 공식 배포처 기준으로 설치 방법을 제시하고, 설치가 가능한 범위는 직접 진행해.

2. 저장소와 브랜치 준비
   - 원격 저장소를 clone 또는 fetch해.
   - `feature/modernization`을 checkout하고 `origin/feature/modernization`과 같은 커밋인지 확인해.
   - `git status --short --branch`로 깨끗한 작업 트리를 확인해.

3. MariaDB 구성
   - `개발환경_고도화/infra/.env.example`을 `infra/.env`로 복사해.
   - root/app 비밀번호를 서로 다른 강한 값으로 설정해.
   - `MARIADB_HOST_PORT=3308`을 유지해.
   - `개발환경_고도화/infra/compose.yaml`의 MariaDB 11.8.8과 named volume을 사용해 기동해.
   - 컨테이너 healthy, `127.0.0.1:3308` 연결, 재시작 후 데이터 유지 여부를 확인해.

4. hoiBot Server 구성
   - Node.js 24 LTS를 사용해 `개발환경_고도화/runtime/`에서 의존성을 설치해.
   - `runtime/.env.example`을 `runtime/.env`로 복사하고 아래를 구성해.
     - `PORT=3002`
     - `DATABASE_ENABLED=true`
     - DB host/port/name/user/password를 MariaDB 설정과 일치
     - 새 `IRIS_SHARED_TOKEN`과 새 `USER_VERIFICATION_PEPPER`
     - 실제 redroid Iris 주소를 확인한 뒤 `IRIS_BASE_URL`
     - 1차 검증은 `IRIS_OPEN_CHAT_OBSERVATION_MODE=observe_all_open`
     - 콘텐츠 보관이 필요하면 정책 문서를 확인하고 `RETAINED_EVENT_CONTENT_SCOPE=all_verified_open`; 무단으로 활성화하지 마
   - migration `001`부터 저장소의 최신 migration까지 적용해.
   - migration을 다시 실행했을 때 no-op인지 확인해.
   - `db:probe`, `db:probe:modernization`, legacy JSON dry-run을 실행해. 실제 import에는 `--apply`를 사용하지 마.
   - 서버를 build하고 `manage-windows-autostart.ps1`로 `hoiBot Modernization Server` 예약 작업을 설치·시작해.
   - 실제 서버 프로세스가 `node.exe`로 3002를 listen하는지 확인해.

5. redroid + KakaoTalk + Iris 구성
   - 목표 구조는 `Windows → Hyper-V/WSL2 Linux → Docker/redroid → KakaoTalk + Iris`다.
   - 기존 redroid가 있으면 파괴하거나 초기화하지 말고 상태부터 확인해.
   - 신규라면 `개발환경_고도화/references/REPRODUCIBLE_ENVIRONMENT_BLUEPRINT.md`와 확정 영상 기준을 따라 구성해.
   - `adb devices -l`에서 redroid가 `device` 상태인지 확인해.
   - Iris `/config`, `/query`, `/reply` 접근을 확인해. `/query`는 읽기 전용으로만 사용해.
   - redroid 안에서 Windows PC의 3002 포트에 TCP 연결 가능한 주소를 찾아. 기억한 IP를 재사용하지 말고 현재 네트워크에서 계산·검증해.
   - Iris callback을 `http://현재_PC_접근가능_IP:3002/api/v1/integrations/iris/events?token=새토큰`으로 설정해.
   - callback URL과 `runtime/.env`의 토큰이 일치하는지만 검증하고 값 자체는 출력하지 마.

6. 호이월드 웹 구성
   - `개발환경_고도화/frontend/`에서 의존성을 설치하고 build해.
   - Vite는 strict port 5175를 사용하고 API proxy가 3002를 향하는지 확인해.
   - 개발 확인 시 `http://localhost:5175/`, 관리자 콘솔은 `/admin/console`을 사용해.
   - 실제 API 데이터만 표시하고 동작하지 않는 UI는 노출하지 않는 현재 정책을 유지해.

7. 관리자 초기화
   - 기존 관리자 비밀번호를 복사하지 마.
   - `admin:bootstrap` 도구로 신규 로컬 최고관리자를 만들고 임시 비밀번호는 Git·문서·로그에 저장하지 마.
   - 로그인, 세션, CSRF, `super_admin` 권한, `/admin/console` 진입을 확인해.

8. 자동 검증
   - runtime: `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`
   - frontend: `npm.cmd run build`
   - `git diff --check`
   - `/health/live`, `/health/ready`, `/api/v1/ping`, `/api/v1/public/overview`
   - MariaDB container health와 migration 최신 상태
   - Docker/서버 재시작 후 readiness 복구

9. 실제 Iris 검증
   - 테스트용 오픈채팅방에서 `/ping` 1건으로 `KakaoTalk → chat_logs → Iris → hoiBot Server → MariaDB/outbox → KakaoTalk` 전체 흐름을 확인해.
   - 사진 1건과 메시지 수정 1건을 별도로 발생시켜 다음 증거를 같은 이벤트 기준으로 대조해.
     1) `db1.chat_logs` 원본 행 존재
     2) Iris callback HTTP 응답
     3) 서버 정규화 event code
     4) `event_inbox`와 `normalized_provider_events` 적재
     5) 이미지의 media 분류 또는 수정의 moderation incident 생성
     6) 관리자 콘솔 표시
   - 현재 인수인계 시점에는 사진과 수정 행이 Kakao DB에 존재하고 Iris가 HTTP 202를 기록했지만, MariaDB 최신 적재 시각과의 불일치가 미해결 상태다. 시간대 표시 문제, 실행 중인 서버 인스턴스, 실제 연결 DB, 트랜잭션 적재를 순서대로 확인하고 증거 없이 해결됐다고 보고하지 마.

10. 완료 보고
   - 설치한 버전, 실제 사용 포트, redroid/ADB 상태, Iris 연결 상태, 서버·DB·웹 상태를 표로 정리해.
   - 실행한 검증과 성공/실패를 구분해.
   - 비밀값은 전부 마스킹해.
   - 미검증 항목과 다음 작업을 `개발환경_고도화/MEMORY.md`에 최신 상태로 반영해.
   - 사용자가 명시적으로 요청하기 전에는 커밋·푸시·운영 반영을 하지 마.

완료 조건은 신규 PC에서 API 3002, MariaDB 3308, 웹 5175, Iris 3000이 충돌 없이 동작하고, 서버와 DB readiness가 정상이며, `/ping`과 사진·수정 이벤트가 Kakao DB부터 관리자 화면까지 동일 이벤트로 추적되는 것이다. 일부 단계가 불가능하면 성공으로 처리하지 말고 정확한 막힌 계층과 다음 조치를 남겨줘.
```

## Related sources

- `../DECISIONS.md`
- `../MEMORY.md`
- `REPRODUCIBLE_ENVIRONMENT_BLUEPRINT.md`
- `IRIS_EVENT_CAPABILITY_MATRIX.md`
- `IRIS_TECHNICAL_REFERENCE.md`
- `../runtime/README.md`
- `../runtime/.env.example`
- `../infra/.env.example`
- `../infra/compose.yaml`

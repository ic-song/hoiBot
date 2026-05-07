# AGENTS.md

이 문서는 `hoiBot` 저장소에서 사람/AI 에이전트가 일관되게 작업하기 위한 공통 규칙입니다.

## 1) 프로젝트 개요

- 이 저장소는 Android 메신저봇 JavaScript 환경에서 동작하는 게임 운영 스크립트 프로젝트입니다.
- 핵심 엔트리 파일:
  - `main.js`: 명령 처리 및 주요 게임 로직
  - `Info.js`: 조회/보조 기능
  - `data/`: 게임 운영 데이터(JSON/TXT)

## 2) 실행 환경 가정

- 런타임: Android 기반 메신저봇 스크립트 엔진
- 주요 콜백: `response(room, msg, sender, isGroupChat, replier, imageDB, packageName)`
- 사용 API 예시: `Api.replyRoom`, `FileStream`, `Device`, `android.os.*`, `java.io.*`
- 실제 운영 데이터 경로: `/sdcard/호이랜드/`
- 개발/테스트 데이터 경로: `/sdcard/호이랜드_dev/`

## 3) 작업 원칙

- 기존 동작 보존을 최우선으로 합니다.
- 대용량 단일 파일(`main.js`) 수정 시 변경 범위를 최소화합니다.
- 데이터 파일 변경 시 JSON 형식 유효성(문법/인코딩)을 반드시 확인합니다.
- 민감 정보(개인정보, 토큰, 비공개 운영 데이터)는 커밋하지 않습니다.
- 사용자의 기존 변경을 되돌리지 않습니다.
- 저장 로직을 바꿀 때는 DEV/PROD 컨텍스트와 `saveJsonFile`, `loadJsonFile` 호출 흐름을 함께 확인합니다.

## 4) 코드 수정 가이드

- 가능하면 작은 단위로 수정하고, 한 커밋에는 한 가지 목적만 담습니다.
- 명령어/분기 로직 수정 시 기존 명령들과 충돌 여부를 함께 점검합니다.
- `data/` 구조를 변경하면 해당 데이터를 읽는 코드(`main.js`, `Info.js`)도 같이 업데이트합니다.
- 인코딩은 UTF-8 기준을 유지합니다.
- 한글/이모지 포함 파일(`main.js`, `Info.js`, `AGENTS.md`, `README.md`, `data/*.json`)은 PowerShell `Get-Content`/`Set-Content`, `cmd > file`, 파이프 리다이렉션으로 복구/일괄수정하지 않습니다. 인코딩이 깨질 수 있습니다.
- 위 파일을 스크립트로 수정해야 하면 Node.js `fs.readFileSync(path, "utf8")` / `fs.writeFileSync(path, text, "utf8")` 또는 `apply_patch`만 사용합니다.
- Git의 파일 내용을 복구할 때는 셸 리다이렉션 대신 `git restore -- <file>`을 우선 사용하고, 불가피하면 `git archive --output=<tmp.tar> HEAD <file>` 후 압축 해제처럼 바이트를 보존하는 방식을 사용합니다.
- 한글/이모지 파일 수정 후에는 `node -e "const fs=require('fs'); console.log(JSON.stringify(fs.readFileSync('Info.js','utf8').slice(0,80)))"`처럼 UTF-8로 직접 읽어 깨짐 여부를 확인합니다.
- 새 함수는 같은 도메인 함수 근처에 둡니다.
- 확률, 보상, 랭킹, 길드, 펫스킬 로직은 밸런스 영향이 크므로 가능하면 상수로 관리합니다.
- 봇 메시지는 유저가 바로 보는 UI입니다. 줄바꿈, 이모지, `allsee` 사용 위치를 조심해서 유지합니다.

## 5) 데이터 파일 가이드

- `data/*.json`은 운영 데이터의 샘플/백업 역할을 겸할 수 있으므로 삭제/초기화에 주의합니다.
- 키 이름 변경은 하위 호환 이슈를 만들 수 있으므로, 필요 시 마이그레이션 로직을 같이 반영합니다.
- 숫자/문자 타입이 섞이지 않도록 기존 스키마를 유지합니다.

## 6) 검증 체크리스트

수정 후 최소 문법 체크:

```bash
node --check main.js
```

`Info.js`를 수정했다면:

```bash
node --check Info.js
```

- 최소 확인 항목:
  - 스크립트 로딩 오류 없음
  - 자주 쓰는 명령어 응답 정상
  - 데이터 읽기/쓰기 경로 오류 없음
  - JSON 파싱 오류 없음
- 가능하면 테스트 방 또는 샌드박스 환경에서 먼저 확인 후 운영 반영합니다.

## 7) Git 작업 규칙

- 보호 브랜치 직접 푸시는 피하고, 작업 브랜치 + PR로 진행합니다.
- 커밋 메시지와 PR 제목/본문은 한글로 작성합니다.
- 작업 브랜치는 `feature/main`을 기준으로 생성합니다.
- 브랜치 용도는 아래 기준으로 구분합니다:
  - `feature/hoi`: 호이 요청사항 반영
  - `feature/bugFix`: 버그 수정
  - `feature/bm`: 패키지 관련 작업
  - `feature/dev-setting`: 개발 환경 설정
  - `feature/doc`: `README.md`, `AGENTS.md`, `.gitignore` 등 문서/설정 문서 수정
  - `feature/<기능명>`: 기능 단위 개발
- 권장 흐름:

```bash
git checkout -b feature/<작업명>
git add -A
git commit -m "type: 변경 요약"
git push origin feature/<작업명>
```

- PR 본문에는 아래를 포함합니다:
  - 변경 목적
  - 주요 변경 파일
  - 사용자 영향(명령/데이터/운영)
  - 확인한 테스트 항목

## 8) 에이전트 행동 규칙

- 모르면 추측보다 코드/데이터를 먼저 확인합니다.
- 관련 없는 파일은 수정하지 않습니다.
- 예기치 않은 대규모 변경이나 포맷 변형이 보이면 즉시 멈추고 확인합니다.
- 실패 로그/재현 단계는 숨기지 말고 작업 결과에 명확히 남깁니다.

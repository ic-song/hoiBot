# hoiBot

`hoiBot`은 카카오톡 메신저봇/Android JavaScript 실행 환경에서 동작하는 호이랜드 게임 봇 스크립트입니다.
회원 데이터, 펫, 미니펫, 길드, 시련의 탑, 캐슬 대전, 게시판, 아이템, 요청 모니터링 등 게임 운영에 필요한 기능을 `main.js` 중심으로 처리합니다.

이 문서는 사람 운영자/개발자가 프로젝트 구조와 실행 환경을 빠르게 파악하기 위한 안내입니다.
AI 에이전트 작업 규칙은 `AGENTS.md`에서 관리합니다.

## AI 서브에이전트 역할 요약

상세한 작업 규칙과 제한사항은 `AGENTS.md`를 기준으로 합니다.
README에서는 사람이 전체 협업 구조를 빠르게 이해할 수 있도록 역할만 요약합니다.

| 에이전트 | 역할 |
| --- | --- |
| `head-agent` | 전체 작업을 조율하고 최종 판단을 담당합니다. |
| `git-agent` | 브랜치 선택, push, PR 생성, 승인된 `feature/prod` 병합, `main` 동기화 PR 정리를 담당합니다. |
| `explorer-agent` | 코드를 읽기 전용으로 탐색하며 명령어, 헬퍼, 데이터 흐름, 저장 흐름을 조사합니다. |
| `coding-agent` | 실제 코드 수정을 담당합니다. 기존 로직 재사용과 최소 변경을 우선합니다. |
| `reviewer-agent` | 변경 후 중복 로직, 회귀 위험, 저장 흐름, 문서 정합성을 검토합니다. |
| `test-agent` | `node --check`, JSON 파싱 등 가능한 범위의 실행/문법 검증을 담당합니다. |
| `encoding-agent` | UTF-8, 한글, 이모지 깨짐을 확인합니다. |
| `doc-agent` | `COMMAND_INDEX.md`, `COMMAND_REGISTRY.md`, README 등 문서 동기화를 담당합니다. |

문서 역할은 크게 두 가지로 나눕니다.

| 문서 | 용도 |
| --- | --- |
| `COMMAND_INDEX.md` | AI용 명령어 탐색 인덱스입니다. 명령어 위치, 관련 헬퍼, 데이터 흐름, 저장 흐름을 추적합니다. |
| `COMMAND_REGISTRY.md` | 사람 확인용 명령어 체크표입니다. 소스, 미사용, 삭제유무, 비고만 관리합니다. |

## 주요 파일

| 파일 | 설명 |
| --- | --- |
| `main.js` | 봇의 메인 스크립트입니다. 명령어 처리, 게임 로직, 데이터 저장/로드, 관리자 기능을 포함합니다. |
| `Info.js` | 정보 조회용 보조 스크립트입니다. 회원/펫/아이템 등 조회성 기능을 담당합니다. |
| `data/` | 봇이 사용하는 JSON/TXT 데이터 예시 및 운영 데이터 확인용 폴더입니다. |
| `tools/` | Git 작업, 운영 반영 등 로컬 개발/운영 보조 배치파일을 모아둔 폴더입니다. |
| `.codex/skills/` | Codex가 사용할 hoiBot 전용 skill 원본입니다. 작업 환경 변경 시 로컬 Codex skill 폴더로 동기화합니다. |
| `.codex/skill-drafts-ko/` | 사람이 검토하기 위한 hoiBot skill 한글판 초안입니다. Codex 자동 로딩용이 아닙니다. |

## Codex Skills

hoiBot 반복 작업용 Codex skill 원본은 저장소의 `.codex/skills/`에서 관리합니다.
새 작업 환경에서는 아래 배치파일로 로컬 Codex skill 폴더에 동기화합니다.

```bat
tools\05_skills_설치.bat
```

동기화 대상:

```text
저장소 원본: .codex/skills/
로컬 사용:  %USERPROFILE%\.codex\skills\
한글 검토본: .codex/skill-drafts-ko/
```

## 데이터 파일

봇 코드는 Android 저장소의 `/sdcard/호이랜드/` 경로를 기준으로 데이터를 읽고 씁니다.
저장소의 `data/` 폴더에 있는 파일은 같은 이름으로 `/sdcard/호이랜드/`에 배치해서 사용할 수 있습니다.

| 파일 | 용도 |
| --- | --- |
| `member.json` | 회원 기본 데이터 |
| `member_pet.json` | 회원별 펫 데이터 |
| `member_title.json` | 회원 칭호 데이터 |
| `pet_title.json` | 펫 칭호 데이터 |
| `miniPetData.json` | 미니펫 기본 데이터 |
| `miniPet_collection.json` | 미니펫 도감 데이터 |
| `miniPet_title.json` | 미니펫 칭호 데이터 |
| `petSkillData.json` | 펫 스킬 데이터 |
| `petSweetHomeData.json` | 펫 스윗홈 유저 데이터 |
| `petSweetHomeInfo.json` | 펫 스윗홈 가구/정보 데이터 |
| `petExploreData.json` | 펫 탐험 데이터 |
| `guildData.json` | 길드 데이터 |
| `trialTower.json` | 시련의 탑 유저 진행 데이터 |
| `trialTowerBoss.json` | 시련의 탑 보스 데이터 |
| `eventTowerBoss.json` | 이벤트 탑 보스 데이터 |
| `castleBattle.json` | 캐슬 대전 데이터 |
| `itemInfo.json` | 아이템 상세 정보 |
| `itemList.json` | 아이템 목록 |
| `board.json` | 게시판 데이터 |
| `carrotBoard.json` | 당근 게시판 데이터 |
| `requestMonitorConfig.json` | 유저 요청 과부하 감지 설정 |
| `game.txt` | 기타 게임 데이터 |

## 실행 환경

이 프로젝트는 메신저봇용 JavaScript 스크립트입니다.

- Android 기반 메신저봇 실행 환경
- `response(room, msg, sender, isGroupChat, replier, imageDB, packageName)` 함수를 호출하는 봇 런타임
- `Api.replyRoom`, `FileStream`, `Device`, `android.os.*`, `java.io.*` API를 지원하는 환경
- 데이터 저장 경로: `/sdcard/호이랜드/`

## 브랜치 운영 전략

운영 반영 기준 브랜치는 `feature/prod`입니다.

| 브랜치 | 용도 |
| --- | --- |
| `main` | 안정/보관 기준 브랜치입니다. 실제 운영 반영 기준으로 바로 사용하지 않습니다. |
| `feature/prod` | 운영 봇에 반영할 기준 브랜치입니다. 운영 반영과 운영 PR의 대상입니다. |
| `feature/hoi` | hoi 작업용 브랜치입니다. `tools/`를 통한 업로드/PR 생성에 사용하며, `feature/prod`에서 분기하고 PR도 `feature/prod`로 요청합니다. |
| `feature/workflow` | 문서, 에이전트 전략, 브랜치 전략, `tools/` 운영 방식 변경을 처리하는 브랜치입니다. |
| `feature/bugFix` | 버그 수정 전용 브랜치입니다. 원인 분석, 최소 수정, 회귀 검증을 묶어서 처리합니다. |

기본 작업 흐름은 아래와 같습니다.

```text
feature/prod 최신화
↓
feature/hoi 작업 브랜치 생성
↓
코드 수정 및 검증
↓
feature/prod 대상으로 PR 생성
↓
검토 후 운영 반영
```

버그 수정은 아래 흐름을 사용합니다.

```text
feature/prod 최신화
↓
feature/bugFix 작업 브랜치 생성
↓
원인 분석, 최소 수정, 회귀 검증
↓
feature/prod 대상으로 PR 생성
↓
검토 후 운영 반영
```

문서/전략/도구 운영 방식 변경은 아래 흐름을 사용합니다.

```text
feature/prod 최신화
↓
feature/workflow 작업 브랜치 생성
↓
README.md / AGENTS.md / tools/ 수정 및 검증
↓
feature/prod 대상으로 PR 생성
↓
검토 후 운영 흐름 반영
```

작업이 위 브랜치 역할에 맞지 않으면 큰 컨텐츠 단위로 새 브랜치를 만듭니다.

```text
feature/<content-name>
```

예시는 `feature/event`, `feature/shop`, `feature/guild`처럼 한 PR에서 함께 검토할 수 있는 기능/컨텐츠 단위로 정합니다.

## 운영 메모

- 데이터 파일은 운영 중 계속 변경되므로 수정 전 백업을 권장합니다.
- 저장소에는 운영 데이터가 포함될 수 있으므로 개인정보, 토큰, 민감한 채팅방 정보가 커밋되지 않도록 확인해야 합니다.
- `main.js`, `Info.js`, 문서, JSON 파일은 UTF-8 기준으로 관리하는 것이 좋습니다.

## 주의사항

- `/sdcard/호이랜드/`의 실제 운영 데이터와 저장소의 `data/` 파일이 다를 수 있습니다.
- 대용량 JSON 파일을 수정할 때는 형식 오류가 나지 않도록 저장 전후로 JSON 구조를 확인하세요.
- 운영 중인 봇에 반영하기 전 테스트방에서 주요 명령어를 먼저 확인하는 것을 권장합니다.

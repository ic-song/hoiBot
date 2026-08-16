# 작업 복구 체크포인트

- 작업 키: modernization-wbs-workflow
- 작업 이름: 슬라이스 중심 고도화 WBS 재정립
- 작업 상태: 검증 완료
- 정리 후보: 아니요
- 체크포인트 버전: 10
- 마지막 갱신: 2026-08-17 KST
- 대화 식별명: 고도화 프로세스 재정립

허용 상태: `진행 중 → 검증 완료 → 작업 완료`

## 현재 목표

- 기존 개발 성과를 RESET하지 않고 기능 슬라이스와 8개 Gate로 승계한다.
- 모든 활성 명령과 최종 데이터를 명령·공유 로직·DB 매핑·합성 fixture·검증 시나리오가 결합된 작업 단위로 관리한다.
- Notion은 새 WBS 링크와 퍼센티지만 표시한다.

## 사용자 요청과 승인 범위

- 기존 WBS를 복제해 새 Google Sheets WBS를 만들어도 된다.
- 새 WBS를 기준 원장으로 사용하고 기존 탭은 이력과 미분류 명령 확인용으로 보존한다.
- WBS 재정립과 관련 스킬·저장소 규칙 변경을 허용한다.
- 역할 표현은 `사용자`, `운영자`, `총괄 운영자`, `개발자`만 사용한다.
- `미사용 검토`는 판단 대기 상태로 유지하고, `미사용` 확정 명령만 이관 대상과 진행률에서 제외한다.
- `미사용` 명령의 기존 Rhino 코드는 유지한다. 이미 생성된 새 시스템 이관 산출물은 공유 의존성 확인 후 제거한다.
- hoiBot 사용자 제작 스킬의 중앙 원본은 `CODEX-CONFIG`이며, 프로젝트 `.codex/skills/`는 동기화된 배포 미러로 사용한다.
- workflow 변경은 `feature/workflow`에서 검증 후 `feature/prod`에 반영한다.

## 고정 리소스

- 새 WBS: `https://docs.google.com/spreadsheets/d/1tlvrlQ1dGb2ijRc6kDKEBRkSdLjQyhc1u9OfiJES3Ps/edit`
- 보존 WBS: `https://docs.google.com/spreadsheets/d/15TP6sa36r_cwh49ny-pOiM3nkhgQ5i_KBYzsqdM0NZw/edit`
- Notion: `https://app.notion.com/p/3bb393bdd7aa81e38bb9ea8d773a8caf?pvs=204`

## 새 기준 구조

- `슬라이스_대시보드`: 퍼센티지 계산
- `슬라이스_WBS`: 슬라이스 상태, 8개 Gate, evidence와 다음 작업
- `슬라이스_명령매핑`: 기존 CMD WBS ID와 명령·별칭·역할 연결
- `슬라이스_DB매핑`: JSON→DB 테이블·컬럼·키·transaction·fixture 연결
- `슬라이스_검증`: 정상·경계·실패·중복·재시작·parity·Shadow 근거
- `슬라이스_선점`: 실행 ID, Lease, Heartbeat, 인계와 worktree 소유권

## 완료된 외부 작업

- 기존 WBS를 `hoiBot 고도화 슬라이스 WBS v2`로 복제했다.
- 새 기준 탭 6개와 초기 슬라이스 16개를 만들었다.
- 확인된 개발 성과는 Gate로 승계하고 통합·Shadow·운영 준비 미확인 단계는 미완료로 유지했다.
- 구현 산출물이 확인되지 않은 2개 항목은 `복구 필요`로 분리했다.
- 새 탭에 헤더, 필터, 열 너비, 상태 validation과 Gate checkbox를 적용했다.
- 브라우저에서 시트 제목과 기존·신규 탭이 함께 보이는지 확인했다.
- Notion을 새 WBS 링크와 7개 퍼센티지만 보이는 화면으로 교체하고 다시 읽어 확인했다.
- `명령어_이관` 사용 상태를 `사용 / 미사용 검토 / 미사용`으로 고정하고 확정 `미사용`만 제외하는 대시보드·도메인 수식을 적용했다.
- WBS 사용안내와 Notion에 `미사용 검토` 및 `미사용` 처리 기준을 추가했다.
- `CODEX-CONFIG/main`에 고도화 스킬과 최신 hoiBot 스킬을 등록하고 로컬 스킬을 중앙 원본 junction으로 전환했다.
- 기존 로컬 hoiBot 스킬은 `%LOCALAPPDATA%/CODEX-CONFIG/backups/skills-20260817-033138`에 보존했다.

## 현재 퍼센티지

- 전체 명령 이관률: 1.8%
- 슬라이스 분류율: 2.5%
- 정의 슬라이스 Gate 평균: 60.2%
- DB 전체 필드 매핑률: 23.0%
- 최종 검증 완료율: 0.0%
- 운영환경 검증률: 0.0%
- 최종 데이터 이관률: 0.0%

## 저장소 변경 범위

- `AGENTS.md`
- `README.md`
- `.codex/skills/hoibot-*/**` 중앙 배포 미러
- `.codex/checkpoints/modernization-wbs-workflow.md`
- `tools/05_skills_설치.bat`
- `tools/사용법.md`
- 외부 중앙 원본 `CODEX-CONFIG`

## 검증

- 중앙 레지스트리 검증과 암호화 금고 테스트 7개 통과
- hoiBot 중앙 스킬 7개와 프로젝트 미러 `quick_validate.py`: 모두 `Skill is valid!`
- 중앙 원본과 프로젝트 미러 7개 내용 일치 확인
- 로컬 hoiBot 스킬 7개 junction 대상 일치 확인
- `git diff --check`: 공백 오류 없음
- 제한된 역할 표현 검색: 저장소 변경 범위와 새 WBS에서 불허 표현 없음
- Sheets: 사용 상태 validation, 확정 `미사용` 제외 수식, 사용안내와 7개 퍼센티지 재조회 완료
- Notion: 새 WBS 링크, 동일한 7개 퍼센티지와 사용 상태 설명 재조회 완료
- 브라우저: 시트 제목과 기존·신규 탭 노출 확인

## 중앙화 완료 조건

1. `CODEX-CONFIG/main`에 중앙 원본과 등록·동기화 규칙이 반영되어야 한다.
2. hoiBot 프로젝트 미러는 `feature/workflow`를 거쳐 `feature/prod`에 반영되어야 한다.
3. 로컬 Codex 스킬은 중앙 원본 junction이어야 하며 기존 복사본 백업 경로가 보존되어야 한다.

## 보안

- 비밀 값, 평문 자격 증명과 불필요한 개인정보를 기록하지 않는다.

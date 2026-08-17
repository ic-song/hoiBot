# SL-CRAFT-RANDOM 체크포인트

- 슬라이스 ID: `SL-CRAFT-RANDOM`
- 도메인: `상점·패키지·제작`
- 작업 레인: `통합`
- 작업자: `하린`
- 실행 ID: `하린-SL-CRAFT-RANDOM-20260817T164136Z-rb6n4q`
- 선점 행: `슬라이스_선점!9행`
- Heartbeat: `2026-08-18 01:44:30 +09:00`
- Lease 만료: `2026-08-18 02:44:30 +09:00`
- Worktree: `C:\Users\obbad\OneDrive\바탕 화면\hoiBot-modernization-craft-random`
- Branch: `feature/modernization-craft-random`
- 기준: `feature/prod@f79f21b`
- 체크포인트 버전: `4`
- 구현 커밋: `4706ad28e7da45124ab4e8cf84bc6bf8ba0d4a0c`, `589accc`
- Push 상태: `origin/feature/modernization-craft-random` 반영 완료
- 상태: `HANDOFF_READY`

## 승계 근거

- 보존 구현 커밋: `0bff45c` — 랜덤 조합 서비스·합성 probe·단위 테스트·evidence
- 보존 체크포인트 커밋: `ea24e2c`
- `47b6a62`로 구현을 승계하고 `84d69a8`로 `feature/modernization` 기준선을 최신 `feature/prod` 기반 작업 브랜치에 병합했다.

## Gate

- [x] 현행 조사 — WBS 및 보존 evidence
- [x] DB 매핑 — inventory 관계형 테이블 매핑 근거
- [x] 합성데이터 — 보존 합성 probe 근거
- [x] 구현 — `0bff45c` 보존 구현 근거
- [x] 통합 — Iris dispatch·합성 probe 명령·전체 회귀 검증
- [x] parity — 현재 `main.js`의 guard·0수량·재료 부족·공성 차단·응답을 단위 테스트로 비교
- [ ] Shadow
- [ ] 운영 준비

현재 진척률은 `6/8 = 75.0%`이다. Shadow와 운영 준비는 수행하지 않았다.

## 작업 대상

- 대표 명령: `/랜덤조합`
- 주요 DB: `item_definitions`, `inventory_stacks`, `inventory_instances`, `inventory_ledger`
- 통합 변경: `app.ts` dispatch, `db:probe:random-box-craft`, 런타임 문서와 wiring 회귀 테스트
- 공용 fixture: `legacy-heart` 40개와 `legacy-random-box` 0개 합성 stack 추가
- 검증: evidence JSON parse, `npm.cmd run typecheck`, 41 suites·166 tests, `npm.cmd run build`, `git diff --check` 통과
- Legacy 저장 위험: 현재 `main.js`의 `/랜덤조합` 성공 분기에는 직접 `saveJsonFile(data, filePath)`가 없으며 새 서비스는 DB transaction·ledger·operation·audit·outbox로 원자 저장한다.
- 환경 확인: Docker·MariaDB CLI·`.env`가 없어 실 DB 검증을 수행하지 못함
- 다음 행동: Docker/MariaDB 준비 후 비운영 Shadow와 `db:probe:random-box-craft`·재시작 검증

## 저장·푸시 정책

- 중요한 단계마다 이 파일과 WBS Heartbeat를 갱신한다.
- 토큰 종료 전 미완료 상태라도 커밋·푸시하고 선점 상태를 `HANDOFF_READY`로 전환한다.

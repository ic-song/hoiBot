# SL-CRAFT-RANDOM 체크포인트

- 슬라이스 ID: `SL-CRAFT-RANDOM`
- 도메인: `상점·패키지·제작`
- 작업 레인: `통합`
- 작업자: `새봄`
- 실행 ID: `새봄-SL-CRAFT-RANDOM-20260817T171514Z-65262b`
- 선점 행: `슬라이스_선점!12행`
- Heartbeat: `2026-08-18 02:28:17 +09:00`
- Lease 만료: `2026-08-18 03:28:17 +09:00`
- Worktree: `C:\Users\user\Desktop\hoiBot-worktrees\새봄-SL-CRAFT-RANDOM-20260817T171514Z-65262b`
- Branch: `feature/modernization-craft-random-saebom-65262b`
- 기준: `feature/prod@f79f21b`
- 체크포인트 버전: `5`
- 승계 커밋: `4706ad2`, `589accc`, `e645e09`
- 구현 커밋: `d938a7d`
- Push 상태: 원격 실행 브랜치에 구현 커밋 반영 완료
- 상태: `HANDOFF_READY`

## 승계 근거

- `origin/feature/modernization-craft-random@e645e09`의 구현·통합·합성 fixture·테스트 evidence를 보존한다.
- 기존 체크포인트 `SL-CRAFT-RANDOM-하린.md`의 1~6 Gate 완료 근거를 현재 코드와 Git에서 재확인했다.
- 현재 `feature/prod@f79f21b`는 승계 브랜치의 조상이므로 최신 운영 기준을 포함한다.

## Gate

- [x] 현행 조사 — `/랜덤조합` guard·helper·출력·save flow 재확인
- [x] DB 매핑 — inventory stack·ledger·operation·execution·audit·outbox transaction 매핑
- [x] 합성데이터 — 비식별 `legacy-heart`·`legacy-random-box` fixture
- [x] 구현 — 랜덤 조합 서비스·합성 probe·단위 테스트
- [x] 통합 — Iris dispatch와 `db:probe:random-box-craft` wiring
- [x] parity — guard·0수량·재료 부족·공성 차단·응답·중복 event 비교
- [x] Shadow — 전용 DB 001~033 migration, 35개 fixture 테이블, 동일 event와 MariaDB 재시작 replay 검증
- [ ] 운영 준비 — 최종 데이터 대사·승인·cutover 미수행

현재 진척률은 `7/8 = 87.5%`이며 완료 evidence를 재설정하지 않는다.

## 명령·저장 흐름

- 대표 명령: `/랜덤조합`, `/랜덤조합 [수량]`
- Legacy 읽기: `member.<sender>.bag['하트💝']`, `member.<sender>.bag['랜덤박스💝']`, `guildData.castleSiegeFlag`
- Legacy 변경: 하트 차감·0개 시 속성 삭제, 랜덤박스 증가
- Legacy 위험: 성공 분기에 직접 `saveJsonFile(data, filePath)` 호출이 없어 재시작 시 유실 가능성이 있다.
- DB transaction: active castle state·identity·두 item stack을 잠근 뒤 balance·ledger·operation·execution·audit·outbox를 원자 반영한다.
- 시험 데이터: 운영 `data/*`를 사용하지 않고 비식별 합성 fixture와 격리 DB만 사용한다.

## 다음 행동

1. 운영 전 최종 snapshot import와 legacy↔MariaDB 수량 대사를 수행한다.
2. backup·restore rehearsal과 live-room smoke 계획을 승인받는다.
3. cutover 승인 뒤에만 운영 전환을 수행한다.

격리 검증 DB `hoibot_rehearsal_random_65262b`는 검증 후 제거했다.

## 남은 위험

- 실제 운영 데이터 최종 import와 live-room smoke는 이번 비운영 Shadow 범위에 포함하지 않는다.
- Legacy의 0개 속성 삭제와 MariaDB의 0-quantity stack 유지 차이를 cutover 대사에서 확인해야 한다.
- `checkRank`의 일부 특수·길드 장식은 별도 공용화 대상이다.

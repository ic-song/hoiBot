# 작업 복구 체크포인트

- 슬라이스 ID: `SL-CRAFT-CASTLE-RESET`
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: 통합
- 작업자명: 새봄
- 실행 ID: `새봄-SL-CRAFT-CASTLE-RESET-20260818T024920Z-vrmxu4`
- 체크포인트 버전: 2
- 마지막 갱신: 2026-08-18 11:52:50 KST
- 작업 상태: `HANDOFF_READY`

## 소유권과 작업 위치

- 선점 원장 행: 18
- 선점 상태: `HANDOFF_READY`
- Heartbeat: 2026-08-18 11:52:50 KST
- Lease 만료: 2026-08-18 12:52:50 KST
- Worktree: `C:/Users/user/Desktop/hoiBot-worktrees/새봄-SL-CRAFT-CASTLE-RESET-20260818T024920Z-vrmxu4`
- Branch: `feature/modernization-craft-castle-reset-saebom-vrmxu4`
- 기준 commit: `origin/feature/modernization`의 `a554f2c`와 최신 `feature/prod` 병합
- 구현·검증 commit: `975dc45` 원격 push 완료
- push 상태: 완료

## 승계한 Gate evidence

- 현행 조사: `/캐슬대전조합` 및 수량 인자와 silent castle-siege 차단 근거 확인
- DB 매핑: inventory stack·ledger, castle season, operation·execution·audit·outbox 매핑 확인
- 합성데이터: 기존 비식별 fixture와 probe 확인
- 구현: DB transaction 기반 service 확인
- 통합: Iris dispatch와 outbox 흐름 확인
- parity: 정상·경계·실패·중복 실행 테스트 근거 확인
- Shadow: 진행 예정
- 운영 준비: 미완료

## 완료한 Shadow evidence

- 격리 DB `hoibot_rehearsal_castle_reset_vrmxu4`에 migration 33개를 적용했다.
- 합성 fixture 71문장을 두 번 적용하고 35개 테이블을 verify-only로 확인했다.
- 고정 event ID로 `/캐슬대전조합 2`를 실행하고 MariaDB 재시작 후 replay-only로 재실행했다.
- 양념치킨 0, 캐슬대전리셋권 2를 유지했고 inventory ledger 2, operation/execution/audit/outbox 각 1건을 확인했다.
- 전체 158개 테스트, typecheck, build, `main.js`와 `Info.js` 구문 검사를 통과했다.
- 운영 JSON 스냅샷과 실운영방 트래픽은 사용하지 않았다.

## 정확한 다음 행동

- 최종 운영 snapshot의 양념치킨·캐슬대전리셋권 수량을 승인된 절차로 대사한다.
- backup/restore 훈련과 승인된 실운영방 smoke 후 cutover 승인을 받는다.

## 안전

- 운영 `data/*`와 실운영방 트래픽을 사용하지 않는다.
- 비밀 값과 운영 개인정보를 기록하지 않는다.

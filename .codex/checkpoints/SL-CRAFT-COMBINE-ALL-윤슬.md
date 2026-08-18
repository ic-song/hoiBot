# 전체조합 통합 체크포인트

- 슬라이스 ID: `SL-CRAFT-COMBINE-ALL`
- 도메인: 상점·패키지·제작
- 작업 레인: 통합
- 작업자명: 윤슬
- 실행 ID: `윤슬-SL-CRAFT-COMBINE-ALL-20260818T060246Z-s545p4`
- 체크포인트 버전: 2
- 마지막 갱신: 2026-08-18 15:17 KST
- 작업 상태: `RELEASED`

## 소유권과 작업 위치

- 선점 원장 행: 33
- Worktree: `C:/Users/user/Desktop/hoiBot-worktrees/윤슬-SL-CRAFT-COMBINE-ALL-20260818T060246Z-s545p4`
- Branch: `feature/modernization-craft-combine-all-yoonseul-s545p4`
- 기준 commit: `a69787b`
- 구현 commit: `5c0f205`
- push 상태: `origin/feature/modernization-craft-combine-all-yoonseul-s545p4` push 확인

## Gate

- 현행 조사: 완료
- DB 매핑: 완료
- 합성데이터: 완료
- 구현: 완료
- 통합: 완료
- parity: 완료
- Shadow: 완료
- 운영 준비: 사용자 지시에 따라 진행하지 않음

## 구현 범위

- `/전체조합`, `/전체조합2` exact dispatch와 최대 정령 조합을 연결한다.
- `SL-SPIRIT-COMBINE`의 공용 item catalog, inventory, ledger, operation, audit, outbox 구조를 재사용한다.
- `/전체조합`의 로컬 공성전·회원 guard와 `/전체조합2`의 별도 inline 경로를 구분하고, 공통 response 회원 gate의 미가입 silent block을 유지한다.
- `/정리`, `ㅇㅇㅇ`의 자동 `runCombineAll` 호출은 지원 의존성으로만 기록하고 전체 정리는 이관하지 않는다.

## 검증 근거

- runtime tests 171개, TypeScript 검사·build, Rhino `main.js` 구문, `git diff --check` 통과
- 33 migrations 2회, 공용 fixture 2회와 verify-only 통과
- fixture checksum: `da170d6cb8e3a71ec5f095a9d038028ebd39cdcd94733195b38ee413d1a34ea8`
- 두 명령의 HTTP dispatch, exact reply, ledger 2건, operation/execution/audit/outbox/delivery 각 1건 확인
- 동일 이벤트 중복과 MariaDB 재시작 replay에서 추가 mutation·delivery 없음
- 격리 DB `hoibot_rehearsal_combine_all_s545p4` 삭제 및 스키마 부재 확인

## 안전 제한

- CMD-06-0082, CMD-06-0083의 `사용` 상태를 변경하지 않는다.
- 운영 `data/*`, 운영 DB, 운영 준비 Gate를 사용하거나 변경하지 않는다.
- `feature/prod`를 수정·반영하지 않는다.

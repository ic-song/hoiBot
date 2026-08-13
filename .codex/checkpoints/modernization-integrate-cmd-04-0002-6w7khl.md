# 작업 복구 체크포인트

- 작업 키: modernization-integrate-cmd-04-0002-6w7khl
- 작업 이름: `/길드가입조건` coordinator 통합
- 체크포인트 버전: 2
- 마지막 갱신: 2026-08-13 16:46 KST
- 작업 상태: 검증 완료·푸시 대기
- 정리 후보: 아니요

## 목표와 범위

- WBS ID: CMD-04-0002
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: coordinator
- 작업자명: 관문
- 실행 ID: 관문-CMD-04-0002-20260813T072522Z-6w7khl
- 목표: 도메인 산출물을 MariaDB adapter·Iris dispatch에 통합하고 합성 DB restart/replay까지 검증한다.

## 소유권과 작업 위치

- 선점 원장 행: 12
- 선점 상태: 활성
- Heartbeat: 2026-08-13 16:47:00 KST
- Lease 만료: 2026-08-13 17:47:00 KST
- 인계 상태: 성벽 실행 인계 승인
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_integrate_04_0002_6w7khl
- Branch: feature/modernization-integrate-cmd-04-0002-6w7khl
- 기준 commit: `9474048`
- push 상태: 미푸시

## 현재 작업

- 완료: 공용 modernization, CMD-04-0001 통합 기준, CMD-04-0002 도메인 산출물 병합. MariaDB adapter, Iris dispatch, 합성 probe 작성 및 DB 검증.
- 변경 파일: 길드가입조건 MariaDB adapter, app dispatch, synthetic probe, 이 체크포인트.
- 검증 결과: 전체 runtime 144 tests, 집중 7 tests, typecheck/build 통과. 일회성 MariaDB에 migration 001~032와 fixture 2회/verify-only 적용 후 100→12345 변경, restart 뒤 동일 event replay에서 operation/execution/audit/outbox 각 1건 유지.
- 남은 위험: 운영 전체 import의 legacy role/subMasters 정합화와 실제 방 smoke는 최종 전환 전에 필요하다.
- 정확한 다음 행동: evidence validator와 diff 검증 후 커밋·push하고 WBS와 선점 원장을 완료 처리한다.

## 영속성

- 체크포인트 Git 추적: 아직 커밋되지 않음
- 원격 포함 상태: 미포함
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음

# 작업 복구 체크포인트

- 작업 키: modernization-integrate-cmd-04-0001-9uhpkj
- 작업 이름: `/길드가입` coordinator 통합
- 체크포인트 버전: 3
- 마지막 갱신: 2026-08-13 16:18 KST
- 작업 상태: 완료
- 정리 후보: 예

## 목표와 범위

- WBS ID: CMD-04-0001
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: coordinator
- 작업자명: 열쇠
- 실행 ID: 열쇠-CMD-04-0001-20260813T070237Z-9uhpkj
- 목표: 도메인 산출물을 공용 migration·fixture·MariaDB adapter·dispatch에 통합하고 합성 DB restart/replay까지 검증한다.
- 선언된 파일 범위: `runtime/migrations`, synthetic fixture, guild MariaDB adapter, app dispatch, integration tests/probe, guild-join evidence. 운영 `data/*`는 수정하지 않는다.

## 소유권과 작업 위치

- 선점 원장 행: 10
- 선점 상태: 활성
- Heartbeat: 2026-08-13 16:16:36 KST
- Lease 만료: 2026-08-13 17:16:36 KST
- 인계 상태: 자물쇠 실행 인계 승인
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_integrate_04_0001_9uhpkj
- Branch: feature/modernization-integrate-cmd-04-0001-9uhpkj
- 기준 commit: e14d8e4 + 도메인 선별 반영 8c585ad, b13c7dc
- push 상태: 원격 포함 확인 (`c639de8`)

## 현재 작업

- 완료: 공용 modernization 기준 병합, 도메인 정책·서비스 선별 반영, migration 032, synthetic fixture, MariaDB adapter, Iris dispatch와 재시작·재처리 probe 통합.
- 인계 산출물: 도메인 구현 `5dd63f5`, 원격 체크포인트 `9edd3af`, `evidence/guild-join/schema-contract.sql`.
- 변경 파일: guild join migration/policy/service/repository, MariaDB adapter, app dispatch, fixture/loader, synthetic probe, slice evidence와 이 체크포인트.
- 검증 결과: evidence validator 통과, runtime 전체 137 tests 통과, typecheck/build 통과, migration 001~032와 fixture 2회 적용 통과, MariaDB 재시작 뒤 확인·동일 이벤트 재처리에서 membership/ticket/ledger/operation/execution/audit/outbox 중복 없음.
- 남은 위험: 운영 전체 snapshot import와 실제 방 smoke는 최종 전환 전 별도 승인·백업·동결 창에서 검증해야 한다.
- 정확한 다음 행동: WBS CMD-04-0001을 검증 완료 100%, 작업_선점 10행을 완료로 갱신한 뒤 다음 길드 도메인 대기 항목을 새 실행으로 선점한다.

## 영속성

- 체크포인트 Git 추적: `c639de8` 포함, 이 최종 상태를 후속 커밋으로 고정
- 원격 포함 상태: 구현·검증 체크포인트 포함 확인
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음

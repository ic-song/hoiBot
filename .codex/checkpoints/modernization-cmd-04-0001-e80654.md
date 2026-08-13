# 작업 복구 체크포인트

- 작업 키: modernization-cmd-04-0001-e80654
- 작업 이름: `/길드가입` 고도화 이관
- 체크포인트 버전: 7
- 마지막 갱신: 2026-08-13 15:58 KST
- 작업 상태: 진행 중
- 정리 후보: 아니요

## 목표와 범위

- WBS ID: CMD-04-0001
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: D
- 작업자명: 자물쇠
- 실행 ID: 자물쇠-CMD-04-0001-20260813T063703Z-e80654
- 목표: `/길드가입 [인자]`의 현재 동작과 저장 흐름을 조사하고 관계형 기능 슬라이스로 이관해 legacy 결과와 합성 MariaDB 결과를 검증한다.
- 선언된 파일 범위: 도메인 전용 Service/Policy/Repository, 단위 테스트, 독립 fixture 또는 probe 초안, evidence. 공용 migration·fixture·dispatch·Queue·COMMAND 문서는 coordinator가 통합한다.

## 소유권과 작업 위치

- 선점 원장 행: 6
- 선점 상태: 활성
- Heartbeat: 2026-08-13 15:58:20 KST
- Lease 만료: 2026-08-13 16:58:20 KST
- 인계 상태: 없음
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_04_0001_e80654
- Branch: feature/modernization-cmd-04-0001-e80654
- 기준 commit: 871cb0f
- push 상태: upstream 동기화 확인 (도메인 구현 `5dd63f5`, 체크포인트 이력 `9c90888`)

## 현재 작업

- 완료: 길드 도메인 후보 84건 조회, 첫 대기 작업 선택, 전용 worktree/branch 생성, 작업_선점 6행 append, 행 번호 우선 소유권 재검증, 상세 WBS 연결, 레거시 guard·별칭·후보 정렬·정원·EXP·확정·취소·save 순서 조사, 도메인 가입 정책 작성, Repository 트랜잭션 계약과 요청·확정·취소 Service 오케스트레이션 작성, 도메인 schema/fixture 계약 초안과 evidence 기록.
- 변경 파일: `개발환경_고도화/runtime/src/guild/guild-join-policy.ts`, `개발환경_고도화/runtime/src/guild/guild-join-repository.ts`, `개발환경_고도화/runtime/src/guild/guild-join-service.ts`, `개발환경_고도화/runtime/test/guild-join-policy.test.ts`, `개발환경_고도화/runtime/test/guild-join-service.test.ts`, `개발환경_고도화/migration-control/evidence/guild-join/slice.json`, `개발환경_고도화/migration-control/evidence/guild-join/schema-contract.sql`, 이 체크포인트.
- 검증 결과: 길드가입 집중 테스트 13건, runtime 전체 137 tests, typecheck와 build, evidence JSON parse, `git diff --check`가 모두 통과했다. strict guard, 목록 순서, 정원·EXP, request/confirm/cancel, 확정 조건 변경 시 pending 무효화, 현재 상태보다 앞선 prior-result replay를 검증했다.
- 남은 위험: MariaDB adapter와 실제 migration/fixture/dispatch는 coordinator 통합 전이라 실행되지 않는다. schema 초안의 길드 정책 projection과 가입권/징집명령 코드는 공용 fixture 계약 확정이 필요하다.
- 정확한 다음 행동: coordinator가 `schema-contract.sql` 기준 MariaDB adapter·migration·fixture·dispatch를 통합할 때 이 도메인 브랜치를 선별 반영하고 합성 DB restart/replay를 검증한다.

## 영속성

- 체크포인트 Git 추적: 버전 6은 `9c90888`에 포함; 버전 7은 이 후속 체크포인트 커밋으로 반영
- 원격 포함 상태: `origin/feature/modernization-cmd-04-0001-e80654`에 포함
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음

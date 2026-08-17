# SL-ACCOUNT-PLATFORM-AUTH 체크포인트

- 도메인: 회원·프로필·재화 / 외부 플랫폼 인증
- 작업자: `하린`
- 실행 ID: `하린-SL-ACCOUNT-PLATFORM-AUTH-20260817T161412Z-q9m2rx`
- 선점 행: `슬라이스_선점!7행`
- 브랜치: `feature/modernization-account-auth`
- 작업 트리: `C:\Users\obbad\OneDrive\바탕 화면\hoiBot-modernization-account-auth`
- 구현 커밋: `11292190336082a203ac0329329ab08aea2e5a8a`
- 체크포인트 갱신: `2026-08-18 01:27:38 +09:00`
- 상태: `HANDOFF_READY` — 개발·통합 검증 완료, MariaDB 실환경 리허설 대기

## 게이트

- [x] 현행 조사
- [x] DB 매핑
- [x] 합성 데이터
- [x] 구현
- [x] 통합 검증
- [ ] 현행 결과 동등성
- [ ] Shadow
- [ ] 운영 준비

현재 Gate 진행률은 `5/8 = 62.5%`이다. 실 DB와 운영 환경 근거가 없는 게이트는 완료로 올리지 않는다.

## 완료 범위

- 가입용 `/가입인증 코드`와 기존 계정 연결용 `/계정인증 코드`를 서로 다른 인증 타입으로 유지
- `/도움말`, `/ping`, `/info`, 가입·계정 인증만 미연결 상태에서 허용하고 나머지 명령은 활성 사이트 계정 연결을 요구
- 사용자 자신의 외부 플랫폼 연결 목록 조회·연결 해제 API 구현
- 관리자 외부 플랫폼 연결 목록·이력 조회, 강제 해제·차단 API 구현
- 관리자가 외부 계정을 사이트 계정에 직접 지정하는 API 제거
- 연결·재연결·해제·차단 이력을 `user_account_external_identity_history`에 누적하고 명령 감사 로그와 같은 트랜잭션에서 기록
- 사이트 계정 1개에 최대 10개 외부 플랫폼 연결, 관리자 설정으로 1~10 범위 변경 구조 유지

## 검증 근거

- `npm.cmd run typecheck` 통과
- `npm.cmd test` 통과: 39 suites, 164 tests, 0 failures
- `npm.cmd run build` 통과
- `git diff --check` 통과(Windows 줄바꿈 경고만 존재)
- 수동 직접 연결 경로가 소스에서 제거되었고 회귀 테스트에서 부재를 검증

## DB·데이터 범위

- 주요 객체: `user_accounts`, `external_identities`, `user_account_external_identity_links`, `user_account_external_identity_history`, `account_verification_challenges`, `command_audit_logs`
- 신규 migration: `035_external_platform_link_history.sql`
- 저장 흐름: 인증 완료·재연결·사용자 해제·관리자 해제/차단을 트랜잭션 처리하고 이력·감사를 함께 남김

## 미완료·다음 작업

- 현재 PC에 Docker/MariaDB와 접속 설정이 없어 격리 MariaDB 리허설을 수행하지 못함
- 빈 MariaDB에서 migration `001~035`를 연속 2회 실행
- 재시작 후 backfill·연결 이력·사용자 해제·관리자 해제/차단·연결 한도 하향 시 기존 연결 유지 여부 확인
- 현행 결과 동등성, Shadow, 운영 준비 게이트 검증


# SL-ACCOUNT-PLATFORM-AUTH 실행 체크포인트

- 도메인: 회원·프로필·재화
- 작업 레인: 도메인
- 작업자: `새봄`
- 실행 ID: `새봄-SL-ACCOUNT-PLATFORM-AUTH-20260818T042136Z-7bzh6v`
- 선점 행: `슬라이스_선점!26행`
- 브랜치: `feature/modernization-account-platform-auth-saebom-7bzh6v`
- 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\새봄-SL-ACCOUNT-PLATFORM-AUTH-20260818T042136Z-7bzh6v`
- Heartbeat: `2026-08-18 13:29:06 +09:00`
- Lease 만료: `2026-08-18 14:29:06 +09:00`
- 상태: `ACTIVE`
- 체크포인트 버전: `2`
- 구현·검증 커밋: `c4cf8a9` (`origin/feature/modernization-account-platform-auth-saebom-7bzh6v` push 완료)

## 승계한 게이트

- [x] 현행 조사 — `/가입인증`, `/계정인증`, `/도움말` 및 미연결 명령 gate 확인
- [x] DB 매핑 — 계정·identity·link·history·challenge·audit 객체 확인
- [x] 합성데이터 — 기존 unit fixture와 migration 034~035 확인
- [x] 구현 — `1129219` 외부 플랫폼 연결 관리 구현
- [x] 통합 — `1129219`, `56e27af` 원격 브랜치 증거 확인
- [x] parity — 정확한 명령 계약, 상태·이력·감사·한도·멱등성 확인
- [x] Shadow — 격리 MariaDB 재시작 전후 최종 상태 동일
- [ ] 운영 준비

현재 진행률은 `7/8 = 87.5%`입니다.

## 발견 및 수정

- 실 DB에서 provider 인증 표시명이 스키마가 허용하지 않는 `observed` trust 값을 사용해 연결 transaction이 롤백되는 문제를 발견했습니다.
- `external_identity_names`의 기존 신뢰 모델에 맞춰 provider 인증 표시명을 `verified`로 기록하도록 최소 수정했습니다.
- 단위 테스트에 실제 SQL trust 값 회귀 검증을 추가했습니다.

## Shadow 증거

- 격리 DB: `hoibot_rehearsal_account_auth_7bzh6v`
- migration: 001~035 적용, 두 번째 실행에서 35개 유지
- fixture: SHA-256 `ddab14f172b31057792ab9cb8da658e609a8861f7fb928d469766fbb05ac3cf9`, 2회 적용과 verify-only에서 35개 대표 테이블 동일
- 흐름: 연결 → 사용자 해제 → 재연결 → 관리자 차단
- 멱등성: 사용자 해제와 관리자 차단 재실행 시 history·audit 중복 없음
- 한도: 활성 한도 1에서 추가 연결 transaction 전체 롤백
- 재시작: 활성 연결 1, 대상 blocked, 이력 `[linked, unlinked, linked, blocked]`, audit 4건, verified challenge 2건, pending challenge 1건 동일

## 데이터·트랜잭션 범위

- DB 객체: `user_accounts`, `external_identities`, `user_account_external_identity_links`, `user_account_external_identity_history`, `account_verification_challenges`, `configuration_values`, `command_audit_logs`
- transaction: 인증 연결·재연결·사용자 해제·관리자 해제/차단과 이력·감사를 단일 경계에서 처리
- 운영 `data/*`는 읽거나 수정하지 않음

## 다음 작업

1. 전체 타입 검사·테스트·빌드와 evidence schema를 검증합니다.
2. 변경을 커밋하고 실행 브랜치를 원격에 푸시합니다.
3. 운영 snapshot 대사·backup/restore·승인된 운영방 smoke 전까지 운영 준비 게이트를 미완료로 유지합니다.

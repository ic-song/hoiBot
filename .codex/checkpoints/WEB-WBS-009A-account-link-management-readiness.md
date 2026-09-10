# WEB-WBS-009A 계정 연결 관리 readiness checkpoint

- Slice: `SL-ACCOUNT-USER-WEB-LINK-MANAGEMENT-01`
- Lease: `Lease2662`
- Catalog/delta/schema: `SC-20260902-1` / `SCD-WEB-20260910-19` / `web-user-account-link-management-readiness-v1`
- Baseline: `0e36833bc250e7dd857181f9cb7731d9aa087072`
- Classification: `PARTIAL EXTENSION`
- Profile/tier: `MUTATION_TRANSACTIONAL` / `T2`
- Responsible audit worker: `/root/web_wbs009a_audit`

## 확정 결과

- `/account/links` 셸과 기존 세션/CSRF, 8자리 30분 challenge, 5회 실패 제한, account-authority lock, receipt·audit 패턴을 재사용한다.
- v1 실제 지원 플랫폼은 app ingress가 존재하는 `KAKAO`다. `DISCORD`는 provider ingress 추가 전 선택지에서 제외한다.
- 본인 연결 목록은 public UUID, platform code/label, status, connectedAt, activeContextCount만 반환한다.
- 발급은 cookie+CSRF+password, 계정 5회/15분·network 20회/15분을 요구한다.
- 해제는 cookie+CSRF+password+confirmed+Idempotency-Key를 요구하고 identity/membership/selection을 `REVOKED/LEFT/CLEARED`로 soft 전이한다.
- 마지막 플랫폼 연결도 해제 가능하며 웹 세션, 포털계정, 게임계정 소유 link, player는 유지한다. 플랫폼 active-player 접근만 즉시 끊는다.
- 같은 portal의 동일 identity 재인증은 기존 soft-revoked 행을 재활성화해야 한다.
- 구현 migration 후보는 `475_user_account_platform_link_management.sql`이며 구현 Lease 직전 번호 충돌을 다시 확인한다.

## Gate

- Gate 1: TRUE
- Gate 2: TRUE
- Gate 3~8: FALSE
- 운영 DB·운영 데이터·`feature/prod`·Gate 8: 변경 없음

구현 API, DTO, repository-qualified R/W Lease key, acceptance와 검증 순서는 `개발환경_고도화/migration-control/evidence/web-user-account-link-management-readiness-20260910/readiness.md`를 따른다.

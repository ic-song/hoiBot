# WEB-WBS-009 세션 만료 상태 체크포인트

- 실행 ID: `웹세션만료-SL-ACCOUNT-USER-WEB-SESSION-EXPIRY-UI-01-20260910081155`
- Lease: `Lease2639`
- catalog_version: `SC-20260902-1`
- delta_id: `SCD-WEB-20260910-3`
- evidence_schema_version: `web-account-session-expiry-v1`
- execution_profile: `READ_UI`
- validation_tier: `T1`

## 범위

- 기존 세션·프로필 API의 401 응답을 사용자에게 보이는 만료 상태로 표시
- 만료 즉시 계정·프로필 표시값과 CSRF 상태 초기화
- 로그인 화면 이동, 상태 안내 포커스, 재로그인 경로 유지
- 375·768·1024·1440px 반응형 및 가로 넘침 검증

## 제외

- `app.ts`, DB, migration, provider, ledger, receipt
- 계정 전환·연결 해제·모든 mutation
- 운영 데이터, `feature/prod`, Gate 8

## 선행 근거

- WEB-WBS-008R Gate 7 GO
- WEB-WBS-009 연결 상세 read Gate 7 GO
- 기존 `GET /api/v1/sessions/current`, `GET /api/v1/player-profiles/current` 재사용
- 동시 Lease2638은 `app.ts` read와 object ledger write이며 본 Lease의 site-web 파일과 비중첩

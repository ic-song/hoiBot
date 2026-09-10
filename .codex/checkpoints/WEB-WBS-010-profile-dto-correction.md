# WEB-WBS-010 profile DTO correction checkpoint

- Lease: Lease2643 (physical claim row corrected after concurrent append)
- CONTROL: corrective non-superseded CONTROL pending after concurrent append reconciliation
- catalog_version: `SC-20260902-1`
- delta_id: `SCD-WEB-20260910-6`
- evidence_schema_version: `web-current-profile-dto-correction-v1`
- source commit: `ae7665dc9519bde972f54995e1babbdc454ff2ff`
- state: Gate 1~7 완료, Gate 8 범위 제외

실제 current-profile API의 `displayName`, `accumulatedLevel`, `server.displayName`을 사용자 셸에서 소비하도록 교정했다. `app.ts`, 인증 라우트, provider, DB, migration, 운영 데이터, `feature/prod`, Gate 8은 변경하지 않는다.

- target commit: `b51754890ae857b8dd71c852a83ac4d2a42e762c`
- independent Gate 7: GO, P0/P1/P2=0
- authoritative CONTROL: `슬라이스_보고수신!5670`

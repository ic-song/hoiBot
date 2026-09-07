# Wave15 검증

- 실제 유입 focused: 공통 READ_ONLY recovery 13/13 및 HTTP ingress 4/4 PASS. 개인방 전용 우회, SHADOW 비활성 시 공통 거부 복귀, DEV 접두어, 운영 환경 DEV 거부, 권한 만료·중복·KST 경계를 검증했다.
- Wave15 실행 fixture: 2/2 PASS. 7종 시나리오를 `buildApp.inject`와 실제 공통 recovery provider 경로로 실행하고 독립 기대 응답 변조를 fail-close 했다.
- 격리 MariaDB 3335: 473개 migration 적용 후 private/dev/prodReject/authDenied/replay/retry1205/restart/tamper/drift/sourceDomainDmlZero PASS. 운영 3306 listener는 변경하지 않았고 임시 DB는 정리했다.
- receipt generation: prior 160건 compact 740,925 bytes/SHA-256 `2d1803d6d217fc60c0357b4aa7a2d7e0b3993233ba571063315c4493ee910975`를 변경하지 않고 7건을 append해 총 167건이다. 전체 compact 배열은 799,649 bytes/SHA-256 `406f4d25a092e48a18c1635ae1eb07188d27241a9d1f2865daf4860fe4e37488`다.
- ledger build/validate는 required 7종 수신증을 기록하되, 명시적 후속 차이 때문에 `legacy-0a10ef65ad4b37cd`의 `BLOCKED_DYNAMIC`을 유지한다. `entrySetSha256=008f1defc6568c4c1c9bfe0e506f9e4d1e2ade940b21261d72173edbfd56b01e`, DIRECT 30, 미증명 1,081이다.
- 예상 가능한 개인방 권한 거부는 HTTP 202 ignored로 응답해 5xx 재시도 회귀를 막는다. 공통 recovery가 남기는 durable FAILED를 정상 거부 receipt로 전환하는 작업은 후속 차이로 유지한다.
- ledger focused negative: coordinated Wave15 receipt 변조 거부 1/1 PASS.
- TypeScript typecheck, object data model 108개, `main.js`/`Info.js` syntax, diff check PASS.
- 운영 데이터 이관은 별도 WBS이며 이 검증에서 수행하지 않았다.

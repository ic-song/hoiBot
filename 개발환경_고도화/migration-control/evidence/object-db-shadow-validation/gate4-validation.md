# WBS744 Gate 4 구현·검증 증거

- 상태: `IMPLEMENTED`
- Shadow provider: `runtime/src/data-migration/object-db-shadow-validation-provider.ts`
- SQL 경계: `runtime/src/database/read-only-sql-boundary.ts`
- 테스트: `runtime/test/object-db-shadow-validation-provider.test.ts`, `runtime/test/read-only-sql-boundary.test.ts`

## 구현 범위

- WBS742 동결 범위인 12개 도메인·45개 직접 대상 테이블 고정 조회
- 메모리 내 deterministic mismatch/quarantine 결과와 SHA-256 fingerprint
- identity, 행 누락·추가·중복, 필드, Unicode, BIGINT, FK 폐쇄성, 테이블 범위, 재시작 drift, mutation-evidence 분류
- 주석·다중문·CTE 내부 write·stored routine/UDF·파일 출력·사용자 변수·sequence 증가·잠금 modifier 차단
- 문자열과 quoted identifier 내부의 키워드는 SQL 구조로 오인하지 않음
- Shadow에는 query capability만 전달하고 execute/transaction 소유권은 제공하지 않음

## 검증

```text
npm.cmd run typecheck
node --import tsx --test test/read-only-sql-boundary.test.ts test/app-wiring-entrypoint-runner.test.ts test/object-db-shadow-validation-provider.test.ts
31 passed, 0 failed
```

Gate 5의 격리 MariaDB read-only 계정과 전후 DB checksum 증거, Gate 6 소비자별 parity, Gate 7 관찰 기간은 별도 미완료다. 따라서 이 문서는 전체 Shadow 완료나 운영 cutover를 주장하지 않는다.

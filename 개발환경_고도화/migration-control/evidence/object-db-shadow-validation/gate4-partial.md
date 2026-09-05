# WBS744 Gate 4 부분 구현 증거

> 이 기록은 중간 체크포인트다. 이후 SQL 실행 경계를 보강해 `gate4-validation.md`에서 Gate 4 구현을 완료했다.

- 상태: `PARTIALLY_IMPLEMENTED`
- 공용 provider: `runtime/src/data-migration/object-db-shadow-validation-provider.ts`
- 검증: `runtime/test/object-db-shadow-validation-provider.test.ts`
- 범위: WBS742에서 동결된 12개 도메인과 45개 직접 대상 테이블
- 실행: 고정된 `SELECT * FROM <table>`만 `AppWiringReadParticipant`에 전달
- 출력: 메모리 내 mismatch 목록과 결정적 SHA-256 fingerprint만 생성
- 검증 항목: identity, 행 누락·추가·중복, 필드, Unicode 바이트, BIGINT 표현, FK 참조 폐쇄성, 테이블 범위, 재시작 drift, 외부 무변경 fingerprint drift

## 통과 명령

```text
npm.cmd run typecheck
node --import tsx --test test/object-db-shadow-validation-provider.test.ts test/object-db-shadow-validation-contract.test.ts
```

## 미완료

- SQL parser 또는 DB 권한으로 증명되는 실행급 read-only 경계
- 격리 MariaDB read-only 계정에서의 전후 schema·행 수·checksum·outbox·receipt·audit·ledger·quarantine 무변경 증거
- WBS743 전체 소비자별 출력 parity와 운영 Shadow 관찰 기간

따라서 이 증거는 Gate 4 완료, Gate 5 이상, 운영 준비 또는 cutover를 주장하지 않는다.

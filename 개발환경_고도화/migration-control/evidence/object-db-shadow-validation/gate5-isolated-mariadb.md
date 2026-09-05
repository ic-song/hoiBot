# WBS744 Gate 5 격리 MariaDB 검증

- 검증일: 2026-09-05 (KST)
- 범위: SC-20260902-1, WBS744 Gate 5
- 데이터: 커밋된 합성 관계형 fixture만 사용
- DB: MariaDB 12.2, loopback `3326`, 임시 datadir
- 적용 migration: 455개 전체 체인
- Shadow 계정: `wbs744_shadow@127.0.0.1`, `SELECT` 권한만 부여

## 검증 결과

- 12개 도메인, 45개 직접 대상 테이블의 투영값이 모두 일치했습니다.
- JavaScript 안전 정수 범위를 넘는 BIGINT와 한글·결합문자·emoji를 원형대로 비교했습니다.
- Shadow 계정의 `UPDATE`는 MariaDB가 거부했습니다.
- 첫 실행과 DB 재시작 후 실행의 투영 fingerprint가 동일했습니다.
- 실행 전후 모든 base table의 스키마 메타데이터, 행 수, `CHECKSUM TABLE` 값이 동일했습니다.
- outbox/receipt/audit/import/quarantine/ledger 이름을 가진 부수효과 테이블의 행 수도 동일했습니다.
- 운영 기본 포트 `3306` listener 상태는 실행 전후 동일했습니다.
- 임시 DB·datadir·포트는 종료 시 정리됐습니다.

```text
WBS744_GATE5_MARIADB_PASS port=3326 tables=45 readOnlyPrincipal=true allTableChecksum=true sideEffectCounts=true parity=true restart=true production3306Unchanged=true
```

## 경계

이 결과는 격리된 Gate 5 검증입니다. 운영 데이터 관찰, 운영 Shadow 기간, 전환 및 롤백 승인을 의미하지 않으며 Gate 6·7은 아직 남아 있습니다.

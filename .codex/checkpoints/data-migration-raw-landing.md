# SL-DATA-MIGRATION-RAW-LANDING-01

- Baseline: `e0d485cfd542e2b7481be1d6dfbc39f8e5245b69`
- Lease: WBS690 / Lease2512
- Scope: sealed RAW snapshot의 byte-exact private bundle과 격리 MariaDB run/file 적재
- Invariants: 원본 수정 0, 실제 경로 비노출, content SHA/size exact, 동일 bundle replay 추가 행 0, run rollback cascade
- Excluded: Common Staging, Catalog Projection, Domain Import, Gate8, 운영DB, feature/prod, legacy main.js/data
